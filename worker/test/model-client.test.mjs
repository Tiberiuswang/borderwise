import test from 'node:test';
import assert from 'node:assert/strict';
import { createModelClient } from '../src/adapters/model-client.mjs';

const messages = [{ role: 'system', content: 'System instructions' }, { role: 'user', content: 'Check my shipment' }];
const parameters = {
  type: 'object',
  properties: { country: { type: 'string' } },
  required: ['country'],
  additionalProperties: false,
};
const tools = [{ type: 'function', function: { name: 'lookup_tariff', description: 'Read the official tariff', parameters } }];
const openAIReply = (content, calls) => Response.json({ choices: [{ message: { content, tool_calls: calls } }] });
const call = (id, args) => ({ id, type: 'function', function: { name: 'lookup_tariff', arguments: args } });

test('legacy model uses the Zhipu settings and preserves the plain completion request', async () => {
  const signal = new AbortController().signal;
  const client = createModelClient({ ZHIPU_API_KEY: 'test-zhipu-key', OPENAI_API_KEY: 'test-other-key' }, {
    fetchImpl: (url, init) => {
      assert.equal(url, 'https://open.bigmodel.cn/api/paas/v4/chat/completions');
      assert.equal(init.method, 'POST');
      assert.equal(init.headers.Authorization, 'Bearer test-zhipu-key');
      assert.equal(init.redirect, 'manual');
      assert.equal(init.signal, signal);
      assert.deepEqual(JSON.parse(init.body), { model: 'glm-5.3-flash', messages, stream: false });
      return openAIReply('  Review the documents.  ', null);
    },
  });
  assert.equal(client.kind, 'zhipu');
  assert.equal(client.model, 'glm-5.3-flash');
  assert.equal(client.providerKey, 'test-zhipu-key');
  assert.deepEqual(await client.complete({ messages, signal }), { content: 'Review the documents.', toolCalls: [] });
});

test('legacy model supports the old OpenAI-named configuration and optional GLM thinking setting', async () => {
  const history = [
    ...messages,
    { role: 'assistant', content: null, tool_calls: [call('call_1', '{"country":"US"}')] },
    { role: 'tool', tool_call_id: 'call_1', content: '{"status":"found"}' },
  ];
  const client = createModelClient({
    OPENAI_API_KEY: 'test-old-key', OPENAI_BASE_URL: 'https://proxy.example/paas/v4/',
    MODEL: 'glm-test', THINKING: 'disabled',
  }, {
    fetchImpl: (url, init) => {
      assert.equal(url, 'https://proxy.example/paas/v4/chat/completions');
      assert.equal(init.headers.Authorization, 'Bearer test-old-key');
      assert.deepEqual(JSON.parse(init.body), {
        model: 'glm-test', messages: history, stream: false, thinking: { type: 'disabled' },
      });
      return openAIReply('Review complete.');
    },
  });
  await client.complete({ messages: history, tools, allowTools: false });
});

test('explicit OpenAI uses its own key and endpoint and does not apply GLM settings', async () => {
  for (const [base, expected] of [
    [undefined, 'https://api.openai.com/v1/chat/completions'],
    ['https://openai-proxy.example/custom/v1/', 'https://openai-proxy.example/custom/v1/chat/completions'],
  ]) {
    const client = createModelClient({
      AI_PROVIDER: 'openai', MODEL: 'openai-test', OPENAI_API_KEY: 'test-openai-key',
      OPENAI_BASE_URL: base, ZHIPU_API_KEY: 'test-wrong-key', ZHIPU_BASE_URL: 'https://zhipu.example', THINKING: 'disabled',
    }, {
      fetchImpl: (url, init) => {
        assert.equal(url, expected);
        assert.equal(init.headers.Authorization, 'Bearer test-openai-key');
        assert.deepEqual(JSON.parse(init.body), { model: 'openai-test', messages, stream: false, tools });
        return openAIReply(null, [call('call_1', '{ "country": "US" }'), call('call_2', '{"country":"GB"}')]);
      },
    });
    assert.equal(client.kind, 'openai');
    assert.equal(client.providerKey, 'test-openai-key');
    assert.deepEqual(await client.complete({ messages, tools }), {
      content: '',
      toolCalls: [
        { id: 'call_1', name: 'lookup_tariff', arguments: '{ "country": "US" }' },
        { id: 'call_2', name: 'lookup_tariff', arguments: '{"country":"GB"}' },
      ],
    });
  }
});

test('OpenAI preserves ill-formed JSON arguments for the tool executor to validate', async () => {
  const client = createModelClient({ OPENAI_API_KEY: 'test-key' }, {
    fetchImpl: () => openAIReply(null, [call('call_1', '{"country":')]),
  });
  assert.deepEqual(await client.complete({ messages, tools }), {
    content: '', toolCalls: [{ id: 'call_1', name: 'lookup_tariff', arguments: '{"country":' }],
  });
});

test('explicit OpenAI retains tool definitions in an answer-only round', async () => {
  const client = createModelClient({ AI_PROVIDER: 'openai', MODEL: 'openai-test', OPENAI_API_KEY: 'test-key' }, {
    fetchImpl: (url, init) => {
      const sent = JSON.parse(init.body);
      assert.deepEqual(sent.tools, tools);
      assert.equal(sent.tool_choice, 'none');
      return openAIReply('Reviewed.');
    },
  });
  assert.equal((await client.complete({ messages, tools, allowTools: false })).content, 'Reviewed.');
});

test('Zhipu accepts documented object arguments from compatible endpoints and normalizes them to strings', async () => {
  const client = createModelClient({ ZHIPU_API_KEY: 'test-key', ZHIPU_BASE_URL: 'https://api.z.ai/api/paas/v4' }, {
    fetchImpl: () => openAIReply(null, [call('call_1', { country: 'US' })]),
  });
  assert.deepEqual(await client.complete({ messages, tools }), {
    content: '', toolCalls: [{ id: 'call_1', name: 'lookup_tariff', arguments: '{"country":"US"}' }],
  });
  const strict = createModelClient({ AI_PROVIDER: 'openai', MODEL: 'openai-test', OPENAI_API_KEY: 'test-key' }, {
    fetchImpl: () => openAIReply(null, [call('call_1', { country: 'US' })]),
  });
  await assert.rejects(strict.complete({ messages, tools }), { code: 'invalid_response' });
});

test('Anthropic maps system text, assistant tool uses, grouped tool results and the tool response', async () => {
  const transcript = [
    ...messages,
    { role: 'system', content: 'More instructions' },
    {
      role: 'assistant', content: 'Checking the records.',
      tool_calls: [call('toolu_1', '{"country":"US"}'), call('toolu_2', '{"country":"GB"}')],
    },
    { role: 'tool', tool_call_id: 'toolu_1', content: '{"status":"found"}' },
    { role: 'tool', tool_call_id: 'toolu_2', content: '{"status":"missing"}' },
    { role: 'user', content: 'Focus on the US result.' },
  ];
  const signal = new AbortController().signal;
  const client = createModelClient({
    AI_PROVIDER: 'anthropic', MODEL: 'claude-test', ANTHROPIC_API_KEY: 'test-claude-key', OPENAI_API_KEY: 'test-wrong-key',
  }, {
    fetchImpl: (url, init) => {
      assert.equal(url, 'https://api.anthropic.com/v1/messages');
      assert.equal(init.headers['x-api-key'], 'test-claude-key');
      assert.equal(init.headers['anthropic-version'], '2023-06-01');
      assert.equal(init.headers.Authorization, undefined);
      assert.equal(init.redirect, 'manual');
      assert.equal(init.signal, signal);
      const sent = JSON.parse(init.body);
      assert.ok(sent.max_tokens > 0);
      assert.equal(sent.model, 'claude-test');
      assert.equal(sent.system, 'System instructions\n\nMore instructions');
      assert.equal(sent.tool_choice, undefined);
      assert.deepEqual(sent.tools, [{ name: 'lookup_tariff', description: 'Read the official tariff', input_schema: parameters }]);
      assert.deepEqual(sent.messages, [
        { role: 'user', content: [{ type: 'text', text: 'Check my shipment' }] },
        { role: 'assistant', content: [
          { type: 'text', text: 'Checking the records.' },
          { type: 'tool_use', id: 'toolu_1', name: 'lookup_tariff', input: { country: 'US' } },
          { type: 'tool_use', id: 'toolu_2', name: 'lookup_tariff', input: { country: 'GB' } },
        ] },
        { role: 'user', content: [
          { type: 'tool_result', tool_use_id: 'toolu_1', content: '{"status":"found"}' },
          { type: 'tool_result', tool_use_id: 'toolu_2', content: '{"status":"missing"}' },
          { type: 'text', text: 'Focus on the US result.' },
        ] },
      ]);
      return Response.json({ content: [
        { type: 'thinking', thinking: 'Private provider reasoning' },
        { type: 'text', text: 'Checking again.' },
        { type: 'tool_use', id: 'toolu_3', name: 'lookup_tariff', input: { country: 'US' } },
        { type: 'text', text: 'One moment.' },
      ] });
    },
  });
  assert.equal(client.kind, 'anthropic');
  assert.deepEqual(await client.complete({ messages: transcript, tools, signal }), {
    content: 'Checking again.\nOne moment.',
    toolCalls: [{ id: 'toolu_3', name: 'lookup_tariff', arguments: '{"country":"US"}' }],
  });
});

test('Anthropic custom endpoint retains definitions when the last request disallows tool use', async () => {
  const client = createModelClient({
    AI_PROVIDER: 'anthropic', MODEL: 'claude-test', ANTHROPIC_API_KEY: 'test-claude-key',
    ANTHROPIC_BASE_URL: 'https://claude-proxy.example/edge/v1/',
  }, {
    fetchImpl: (url, init) => {
      assert.equal(url, 'https://claude-proxy.example/edge/v1/messages');
      const sent = JSON.parse(init.body);
      assert.equal(sent.tools.length, 1);
      assert.deepEqual(sent.tool_choice, { type: 'none' });
      return Response.json({ content: [{ type: 'text', text: 'Review complete.' }] });
    },
  });
  assert.deepEqual(await client.complete({ messages, tools, allowTools: false }), {
    content: 'Review complete.', toolCalls: [],
  });
});

test('invalid provider configuration fails closed without contacting a provider', () => {
  for (const env of [
    null, {}, { AI_PROVIDER: 'unknown', OPENAI_API_KEY: 'test-key' },
    { AI_PROVIDER: 'openai', OPENAI_API_KEY: 'test-key' },
    { AI_PROVIDER: 'openai', MODEL: 'openai-test', ZHIPU_API_KEY: 'test-key' },
    { AI_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'test-key' },
    { AI_PROVIDER: 'anthropic', MODEL: 'claude-test', OPENAI_API_KEY: 'test-key' },
    { OPENAI_API_KEY: '   ' }, { OPENAI_API_KEY: 'test-key', MODEL: 'x'.repeat(201) },
    ...['http://insecure.example', 'https://user:pass@custom.example', 'https://custom.example/v1?a=1', 'https://custom.example/v1#secret'].map(
      OPENAI_BASE_URL => ({ OPENAI_API_KEY: 'test-key', OPENAI_BASE_URL }),
    ),
  ]) {
    assert.equal(createModelClient(env, { fetchImpl: () => assert.fail('Provider must not be called') }), null);
  }
});

test('malformed and duplicate tool calls are rejected as invalid provider output', async () => {
  const cases = [
    [false, () => openAIReply('', [call('call_1', 20)])],
    [false, () => openAIReply('', [call('call_1', '{}'), call('call_1', '{}')])],
    [false, () => openAIReply('', [{ id: 'call_1', type: 'custom' }])],
    [false, () => openAIReply('   ')],
    [false, () => Response.json({ choices: { 0: { message: { content: 'not array' } } } })],
    [true, () => Response.json({ content: [{ type: 'tool_use', id: 'toolu_1', name: 'lookup_tariff', input: [] }] })],
    [true, () => Response.json({ content: [{ type: 'text', text: false }] })],
  ];
  for (const [anthropic, fetchImpl] of cases) {
    const env = anthropic
      ? { AI_PROVIDER: 'anthropic', MODEL: 'claude-test', ANTHROPIC_API_KEY: 'test-key' }
      : { OPENAI_API_KEY: 'test-key' };
    const client = createModelClient(env, { fetchImpl });
    await assert.rejects(client.complete({ messages, tools }), { code: 'invalid_response' });
  }
});

test('bounded response reading accepts the injected reader and does not expose raw error bodies', async () => {
  const env = { OPENAI_API_KEY: 'test-key' };
  const response = openAIReply('OK');
  let reads = 0;
  const injected = createModelClient(env, {
    fetchImpl: () => response,
    readBytes: async (body, limit) => {
      reads++;
      assert.equal(body, response.body);
      assert.equal(limit, 1024 * 1024);
      return new Uint8Array(await new Response(body).arrayBuffer());
    },
  });
  assert.equal((await injected.complete({ messages })).content, 'OK');
  assert.equal(reads, 1);

  const streamBytes = new Uint8Array(1024 * 1024 + 1);
  for (const [fetchImpl, expected] of [
    [() => new Response('private provider details', { status: 403 }), 'request_failed'],
    [() => new Response('private provider details'), 'invalid_response'],
    [() => new Response(streamBytes), 'invalid_response'],
    [() => new Response('declared too large', { headers: { 'Content-Length': String(streamBytes.length) } }), 'invalid_response'],
  ]) {
    const client = createModelClient(env, { fetchImpl });
    await assert.rejects(client.complete({ messages }), error => {
      assert.equal(error.code, expected);
      assert.doesNotMatch(error.message, /private provider details|declared too large/);
      return true;
    });
  }
});
