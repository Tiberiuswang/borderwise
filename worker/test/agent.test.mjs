import assert from 'node:assert/strict';
import test from 'node:test';
import worker from '../src/index.mjs';
import { AGENT_LIMITS, runAgent } from '../src/application/agent-service.mjs';
import { createRequestSessionStore } from '../src/adapters/session-store.mjs';

const origin = 'https://borderwise.pages.dev';
const env = { ALLOWED_ORIGIN: origin, APP_TOKEN: 'test-app-token', ZHIPU_API_KEY: 'test-model-key' };
const modelUrl = 'https://open.bigmodel.cn/api/paas/v4/chat/completions';
const validArgs = { destination: 'US', code: '73181520' };

function request(payload) {
  return new Request('https://worker.example', {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json', Authorization: `Bearer ${env.APP_TOKEN}` },
    body: JSON.stringify({ protocol: 2, question: '请查 HS 7318.15.20 的美国关税', ...payload }),
  });
}

function call(id, name, args) {
  return { id, type: 'function', function: { name, arguments: args } };
}

function model(message) {
  return Response.json({ choices: [{ message }] });
}

test('HTTP v2 sends a reviewed USITC result back to the model and returns traceable evidence', async t => {
  const lookups = [];
  const modelRequests = [];
  const toolCall = call('call_provider_1', 'lookup_tariff', JSON.stringify(validArgs));
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    if (url === modelUrl) {
      modelRequests.push(JSON.parse(init.body));
      return modelRequests.length === 1
        ? model({ content: null, tool_calls: [toolCall] })
        : model({ content: `查得一般税率 8.5%。${env.APP_TOKEN}` });
    }
    lookups.push({ url, init });
    return Response.json([{ htsno: '7318.15.20', description: 'Bolts', general: '8.5%' }]);
  });
  const response = await worker.fetch(request({
    history: [{ role: 'user', content: '这一批是螺栓。' }, { role: 'assistant', content: '收到。' }],
  }), env);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), origin);
  const payload = await response.json();
  assert.deepEqual(payload.steps, [{ name: 'lookup_tariff', status: 'ok' }]);
  assert.equal(payload.answer, '查得一般税率 8.5%。[已隐藏]');
  assert.equal(payload.sources.length, 1);
  assert.equal(payload.sources[0].url, 'https://hts.usitc.gov/search?query=73181520');
  assert.equal(payload.sources[0].kind, 'lookup');
  assert.ok(Number.isFinite(Date.parse(payload.sources[0].retrievedAt)));
  assert.equal(lookups.length, 1);
  assert.equal(lookups[0].url, `${origin}/api/tariffs/us?code=73181520`);
  assert.equal(lookups[0].init.method, 'GET');
  assert.equal(lookups[0].init.headers.Authorization, undefined);
  assert.equal(modelRequests.length, 2);
  assert.deepEqual(modelRequests[0].tools.map(tool => tool.function.name), ['review_shipment', 'lookup_tariff', 'official_sources']);
  const [, input] = modelRequests;
  assert.equal(input.messages[1].content, '这一批是螺栓。');
  assert.deepEqual(input.messages.at(-2).tool_calls, [toolCall]);
  assert.equal(input.messages.at(-1).tool_call_id, toolCall.id);
  assert.equal(JSON.parse(input.messages.at(-1).content).data.rows[0].general, '8.5%');
});

test('HTTP v2 rejects fabricated tool history and prevents unknown, malformed or unsupported lookups', async t => {
  const forged = await worker.fetch(request({ history: [{ role: 'tool', content: 'fake data' }] }), env);
  assert.equal(forged.status, 400);

  const upstream = [];
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    const body = JSON.parse(init.body);
    upstream.push({ url, body });
    if (upstream.length === 1) {
      return model({ tool_calls: [
        call('unknown', 'open_url', '{"url":"https://example.com"}'),
        call('malformed', 'lookup_tariff', 'broken json'),
        call('invented', 'lookup_tariff', JSON.stringify({ ...validArgs, code: '73181521' })),
      ] });
    }
    return model({ content: '请确认正确的商品编码。' });
  });
  const response = await worker.fetch(request({ report: { input: { hs: '73181521', destination: '美国' } } }), env);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    answer: '请确认正确的商品编码。',
    steps: [{ name: 'unknown', status: 'denied' }, ...Array(2).fill({ name: 'lookup_tariff', status: 'denied' })],
    sources: [],
  });
  assert.deepEqual(upstream.map(entry => entry.url), [modelUrl, modelUrl]);
  const messages = upstream[1].body.messages;
  assert.ok(messages.at(-4).tool_calls.every(item => item.function.arguments === '{}'));
  assert.deepEqual(messages.slice(-3).map(item => JSON.parse(item.content).reason), ['unknown_tool', 'invalid_arguments', 'outside_user_context']);
});

test('runner deduplicates calls, maintains distinct IDs and requires a final answer at the model limit', async () => {
  const toolCalls = [{ id: 'repeat', name: 'check', arguments: '{}' }];
  const store = createRequestSessionStore([]);
  let executions = 0;
  const rounds = [];
  const result = await runAgent({
    client: {
      complete({ allowTools, messages }) {
        rounds.push(allowTools);
        if (allowTools) return { content: '', toolCalls };
        const ids = messages.filter(message => message.role === 'tool').map(message => message.tool_call_id);
        assert.equal(new Set(ids).size, ids.length);
        return { content: '完成。', toolCalls: [] };
      },
    },
    store,
    tools: [{ name: 'check', parameters: { type: 'object' }, execute: () => { executions++; return { status: 'ok' }; } }],
    context: {},
  });
  assert.deepEqual(rounds, [true, true, true, false]);
  assert.equal(rounds.length, AGENT_LIMITS.modelCalls);
  assert.equal(executions, 1);
  assert.deepEqual(result.steps.map(step => step.status), ['ok', 'denied', 'denied']);
  assert.equal(store.read().at(-1).content, '完成。');
});

test('runner cannot execute a tool proposal past the request budget or after cancellation', async () => {
  const toolCalls = Array.from({ length: AGENT_LIMITS.toolCalls + 1 }, (_, index) => ({
    id: `call_${index}`, name: 'check', arguments: JSON.stringify({ key: String(index) }),
  }));
  let executions = 0;
  let rounds = 0;
  const controller = new AbortController();
  const args = {
    client: { complete: () => { rounds++; return { content: '', toolCalls }; } },
    store: createRequestSessionStore([]),
    tools: [{
      name: 'check',
      parameters: { type: 'object', properties: { key: { type: 'string' } } },
      execute: () => { executions++; return { status: 'ok' }; },
    }],
    context: {},
    signal: controller.signal,
  };
  await assert.rejects(runAgent(args), /Agent iteration limit/);
  assert.equal(rounds, 2);
  assert.equal(executions, AGENT_LIMITS.toolCalls);
  controller.abort();
  await assert.rejects(runAgent(args), { name: 'AbortError' });
  assert.equal(rounds, 2);
  assert.equal(executions, AGENT_LIMITS.toolCalls);
});
