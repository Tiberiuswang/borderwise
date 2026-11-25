import { modelTools, reviewToolCall } from '../domain/tool-reviewer.mjs';

export const AGENT_LIMITS = Object.freeze({ modelCalls: 4, toolCalls: 4, toolResultBytes: 8_000 });
const encoder = new TextEncoder();
const TOOL_STATUSES = new Set(['ok', 'needs_input', 'unavailable']);

function toolMessage(call, decision, usedIds) {
  let { id, name } = call;
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(id ?? '') || usedIds.has(id)) {
    id = `borderwise_${usedIds.size}`;
    while (usedIds.has(id)) id += '_';
  }
  usedIds.add(id);
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(name ?? '')) name = 'unknown';
  return { id, type: 'function', function: { name, arguments: JSON.stringify(decision.args ?? {}) } };
}

function safeSources(sources) {
  if (!Array.isArray(sources)) return [];
  return sources.slice(0, 8).flatMap(source => {
    try {
      if (typeof source?.title !== 'string' || !source.title.trim() || typeof source.url !== 'string' ||
          !['lookup', 'reference'].includes(source.kind)) return [];
      const url = new URL(source.url);
      if (url.protocol !== 'https:' || url.username || url.password) return [];
      const result = { title: source.title.slice(0, 160), url: url.href, kind: source.kind };
      const isWeb = typeof source.id === 'string' && /^w[1-9][0-9]{0,2}$/.test(source.id) &&
        ((source.method === 'page' && source.kind === 'lookup') ||
         (source.method === 'search' && source.kind === 'reference'));
      if (isWeb) {
        result.id = source.id;
        result.method = source.method;
        if (typeof source.publishedAt === 'string' && Number.isFinite(Date.parse(source.publishedAt))) {
          result.publishedAt = new Date(source.publishedAt).toISOString().slice(0, 10);
        }
      }
      if ((source.kind === 'lookup' || isWeb) && typeof source.retrievedAt === 'string' &&
          Number.isFinite(Date.parse(source.retrievedAt))) {
        result.retrievedAt = new Date(source.retrievedAt).toISOString();
      }
      return [result];
    } catch {
      return [];
    }
  });
}

async function executeTool({ allowed, tool, args, reason }, context, signal, executed) {
  if (!allowed) return { status: 'denied', reason };
  const key = JSON.stringify([tool.name, Object.entries(args).sort(([a], [b]) => a.localeCompare(b))]);
  if (executed.has(key)) return { status: 'denied', reason: 'duplicate_call' };
  executed.add(key);
  try {
    signal?.throwIfAborted();
    const result = await tool.execute(args, context, signal);
    signal?.throwIfAborted();
    if (!TOOL_STATUSES.has(result?.status)) return { status: 'error' };
    return { status: result.status, data: result.data, sources: safeSources(result.sources) };
  } catch {
    signal?.throwIfAborted();
    return { status: 'error' };
  }
}

export async function runAgent({ client, store, tools, context, signal }) {
  const registry = new Map(tools.map(tool => [tool.name, tool]));
  const definitions = modelTools(tools);
  const executed = new Set();
  const usedIds = new Set();
  const steps = [];
  const sources = new Map();

  for (let turn = 0; turn < AGENT_LIMITS.modelCalls; turn += 1) {
    signal?.throwIfAborted();
    const remaining = AGENT_LIMITS.toolCalls - steps.length;
    const allowTools = remaining > 0 && turn + 1 < AGENT_LIMITS.modelCalls;
    const messages = await store.read();
    const reply = await client.complete({ messages, tools: definitions, signal, allowTools });
    signal?.throwIfAborted();

    if (!reply.toolCalls.length) {
      const answer = reply.content.trim().slice(0, 16_000);
      if (!answer) throw new Error('Empty model answer');
      await store.append({ role: 'assistant', content: answer });
      const cited = new Set([...answer.matchAll(/\[(w[1-9][0-9]{0,2})\]/g)].map(match => match[1]));
      const available = [...sources.values()];
      const ordered = [...available.filter(source => cited.has(source.id)),
        ...available.filter(source => !cited.has(source.id))];
      return { answer, steps, sources: ordered.slice(0, 8) };
    }
    if (!allowTools) throw new Error('Agent iteration limit');

    const calls = reply.toolCalls.slice(0, remaining).map(call => {
      const decision = reviewToolCall(call, registry, context);
      return { decision, message: toolMessage(call, decision, usedIds) };
    });
    await store.append({
      role: 'assistant',
      content: reply.content.slice(0, 4_000) || null,
      tool_calls: calls.map(call => call.message),
    });
    for (const { decision, message } of calls) {
      const result = await executeTool(decision, context, signal, executed);
      let content = JSON.stringify(result);
      if (encoder.encode(content).byteLength > AGENT_LIMITS.toolResultBytes) {
        result.status = 'error';
        result.sources = [];
        content = '{"status":"error","reason":"result_too_large"}';
      }
      const { name } = message.function;
      steps.push({ name: registry.has(name) ? name : 'unknown', status: result.status });
      for (const source of result.sources || []) {
        const key = source.id || source.url;
        const previous = sources.get(key);
        if (!previous || previous.kind !== 'lookup') sources.set(key, source);
      }
      await store.append({ role: 'tool', tool_call_id: message.id, content });
    }
  }
  throw new Error('Agent iteration limit');
}
