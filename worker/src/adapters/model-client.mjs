const MAX_RESPONSE_BYTES = 1024 * 1024;
const ANTHROPIC_VERSION = '2023-06-01';
const ANTHROPIC_MAX_TOKENS = 1600;

function endpoint(base, path) {
  try {
    const url = new URL(base);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) return null;
    url.pathname = url.pathname.replace(/\/+$/, '') + '/' + path;
    return url.href;
  } catch {
    return null;
  }
}

function providerConfig(env) {
  const kind = env.AI_PROVIDER || 'zhipu';
  switch (kind) {
    case 'zhipu':
      return {
        kind,
        key: env.ZHIPU_API_KEY || env.OPENAI_API_KEY,
        base: env.ZHIPU_BASE_URL || env.OPENAI_BASE_URL || 'https://open.bigmodel.cn/api/paas/v4',
        model: env.MODEL || 'glm-5.3-flash',
      };
    case 'openai':
      return {
        kind, key: env.OPENAI_API_KEY, model: env.MODEL,
        base: env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
      };
    case 'anthropic':
      return {
        kind, key: env.ANTHROPIC_API_KEY, model: env.MODEL,
        base: env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com/v1',
      };
    default:
      return null;
  }
}

async function readResponseBytes(stream, limit) {
  if (!stream) return new Uint8Array();
  const reader = stream.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        reader.cancel().catch(() => {});
        throw new Error('Model response too large');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function responseError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function invalidResponse() {
  return responseError('invalid_response', 'Invalid model response');
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function makeToolCall(id, name, args) {
  if (typeof id !== 'string' || !id.trim() || typeof name !== 'string' || !name.trim() || typeof args !== 'string') {
    throw invalidResponse();
  }
  return { id, name, arguments: args };
}

function modelResult(content, toolCalls) {
  if (new Set(toolCalls.map(call => call.id)).size !== toolCalls.length) throw invalidResponse();
  const text = typeof content === 'string' ? content.trim() : '';
  if (!text && !toolCalls.length) throw invalidResponse();
  return { content: text, toolCalls };
}

function openAIResult(payload, kind) {
  if (!Array.isArray(payload?.choices)) throw invalidResponse();
  const message = payload?.choices?.[0]?.message;
  if (!isObject(message)) throw invalidResponse();
  const calls = message.tool_calls ?? [];
  if (!Array.isArray(calls)) throw invalidResponse();
  const toolCalls = calls.map(call => {
    if (call?.type !== 'function') throw invalidResponse();
    const args = call.function?.arguments;
    return makeToolCall(call.id, call.function?.name, kind === 'zhipu' && isObject(args) ? JSON.stringify(args) : args);
  });
  return modelResult(message.content, toolCalls);
}

function anthropicResult(payload) {
  if (!Array.isArray(payload?.content)) throw invalidResponse();
  const text = [];
  const toolCalls = [];
  for (const block of payload.content) {
    if (block?.type === 'text') {
      if (typeof block.text !== 'string') throw invalidResponse();
      text.push(block.text);
    } else if (block?.type === 'tool_use') {
      if (!isObject(block.input)) throw invalidResponse();
      toolCalls.push(makeToolCall(block.id, block.name, JSON.stringify(block.input)));
    }
  }
  return modelResult(text.join('\n'), toolCalls);
}

function anthropicToolUse(call) {
  try {
    const input = JSON.parse(call.function.arguments);
    if (isObject(input)) return { type: 'tool_use', id: call.id, name: call.function.name, input };
  } catch {
    // Reject malformed history without including its contents in the error.
  }
  throw new Error('Invalid tool input in model context');
}

function anthropicRequest(model, messages, tools, allowTools) {
  const system = [];
  const conversation = [];
  for (const message of messages) {
    if (message.role === 'system') {
      system.push(message.content);
      continue;
    }
    const role = message.role === 'tool' ? 'user' : message.role;
    const content = [];
    if (message.role === 'tool') {
      content.push({ type: 'tool_result', tool_use_id: message.tool_call_id, content: message.content });
    } else {
      if (message.content) content.push({ type: 'text', text: message.content });
      if (message.role === 'assistant' && message.tool_calls?.length) {
        content.push(...message.tool_calls.map(anthropicToolUse));
      }
    }
    if (!content.length) continue;
    const previous = conversation.at(-1);
    if (previous?.role === role) previous.content.push(...content);
    else conversation.push({ role, content });
  }
  return {
    model,
    max_tokens: ANTHROPIC_MAX_TOKENS,
    ...(system.length ? { system: system.join('\n\n') } : {}),
    messages: conversation,
    ...(tools.length ? {
      tools: tools.map(({ function: definition }) => ({
        name: definition.name,
        description: definition.description,
        input_schema: definition.parameters,
      })),
      ...(!allowTools ? { tool_choice: { type: 'none' } } : {}),
    } : {}),
  };
}

export function createModelClient(env = {}, { fetchImpl = globalThis.fetch, readBytes = readResponseBytes } = {}) {
  if (!isObject(env)) return null;
  const config = providerConfig(env);
  if (!config) return null;
  const { kind, model, key: providerKey } = config;
  if (typeof providerKey !== 'string' || !providerKey.trim() ||
      typeof model !== 'string' || !model.trim() || model.length > 200) return null;
  const anthropic = kind === 'anthropic';
  const url = endpoint(config.base, anthropic ? 'messages' : 'chat/completions');
  if (!url) return null;

  async function complete({ messages, tools = [], allowTools = true, signal }) {
    // Zhipu supports only tool_choice="auto"; withhold definitions for an answer-only round.
    const declareTools = tools.length > 0 && (allowTools || kind !== 'zhipu');
    const body = anthropic ? anthropicRequest(model, messages, tools, allowTools) : {
      model,
      messages,
      stream: false,
      ...(declareTools ? { tools, ...(!allowTools ? { tool_choice: 'none' } : {}) } : {}),
      ...(kind === 'zhipu' && env.THINKING === 'disabled' ? { thinking: { type: 'disabled' } } : {}),
    };
    const headers = anthropic ? {
      'Content-Type': 'application/json',
      'x-api-key': providerKey,
      'anthropic-version': ANTHROPIC_VERSION,
    } : {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + providerKey,
    };
    const response = await fetchImpl(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      redirect: 'manual',
      signal,
    });
    if (!response.ok) {
      response.body?.cancel().catch(() => {});
      throw responseError('request_failed', 'Model request failed');
    }
    if (Number(response.headers.get('Content-Length')) > MAX_RESPONSE_BYTES) {
      response.body?.cancel().catch(() => {});
      throw invalidResponse();
    }
    let payload;
    try {
      const bytes = await readBytes(response.body, MAX_RESPONSE_BYTES);
      payload = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    } catch (error) {
      if (signal?.aborted) throw error;
      throw invalidResponse();
    }
    return anthropic ? anthropicResult(payload) : openAIResult(payload, kind);
  }

  return { kind, model, providerKey, complete };
}
