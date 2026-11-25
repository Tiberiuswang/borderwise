import assert from 'node:assert/strict';
import test from 'node:test';

import worker from '../src/index.mjs';

const origin = 'https://borderwise.example';
const api = 'https://open.bigmodel.cn/api/paas/v4';
const modelUrl = `${api}/chat/completions`;
const searchUrl = `${api}/web_search`;
const readerUrl = `${api}/reader`;
const env = {
  ALLOWED_ORIGIN: origin,
  APP_TOKEN: 'fixture-browser-token',
  ZHIPU_API_KEY: 'fixture-provider-key',
};

const question = 'What is the CBP guidance for US importers?';
const sourceUrl = 'https://www.cbp.gov/trade/basic-import-export';
const sourceTitle = 'Basic Importing and Exporting';
const snippet = 'Look up CBP importer guidance.';
const pageText = 'Importers must exercise reasonable care in the entry process.';

const searchResult = { search_result: [{
  title: sourceTitle, link: sourceUrl, content: snippet, publish_date: '2026-11-01',
}] };
const pageResult = { reader_result: { title: sourceTitle, url: sourceUrl, content: pageText } };

function ask(payload, { token = env.APP_TOKEN, runtimeEnv = env } = {}) {
  const headers = { Origin: origin, 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  return worker.fetch(new Request(`${origin}/api/ai`, {
    method: 'POST', headers, body: JSON.stringify(payload),
  }), runtimeEnv);
}

function reply(content, toolCalls) {
  return Response.json({ choices: [{ message: { content, tool_calls: toolCalls } }] });
}

function toolCall(id, name, args = {}) {
  return { id, type: 'function', function: { name, arguments: JSON.stringify(args) } };
}

function toolNames(body) {
  return (body.tools || []).map(tool => tool.function.name);
}

function toolResult(body, id) {
  return JSON.parse(body.messages.find(message => message.tool_call_id === id)?.content || 'null');
}

function mockUpstream(t, model, { reader = () => Response.json(pageResult) } = {}) {
  const requests = [];
  let models = 0;
  t.mock.method(globalThis, 'fetch', async (input, init) => {
    const request = new Request(input, init);
    const raw = await request.text();
    const body = raw && JSON.parse(raw);
    requests.push({ url: request.url, method: request.method, headers: request.headers, body });
    if (request.url === modelUrl) return model(body, models++);
    if (request.url === searchUrl) return Response.json(searchResult);
    if (request.url === readerUrl) return reader();
    throw new Error(`Unexpected upstream ${request.url}`);
  });
  return requests;
}

test('requires protocol 2 and explicit web opt-in before exposing tools or contacting the supplier', async t => {
  const requests = mockUpstream(t, body => {
    const names = toolNames(body);
    assert.equal(names.includes('web_search'), false);
    assert.equal(names.includes('read_page'), false);
    return reply('请查看 CBP 官方资料。');
  });

  const unauthorized = await ask({ question, protocol: 2, webSearch: true }, { token: '' });
  assert.equal(unauthorized.status, 401);
  const invalid = await ask({ question, protocol: 2, webSearch: 'true' });
  assert.equal(invalid.status, 400);
  assert.deepEqual(requests, []);

  for (const flags of [{ protocol: 2 }, { protocol: 2, webSearch: false }, { protocol: 1, webSearch: true }]) {
    const res = await ask({ question, ...flags });
    assert.equal(res.status, 200);
    const result = await res.json();
    assert.equal(result.answer, '请查看 CBP 官方资料。');
    if (flags.protocol === 2) assert.deepEqual(result.sources, []);
    else assert.deepEqual(result, { answer: '请查看 CBP 官方资料。' });
  }
  assert.deepEqual(requests.map(request => request.url), [modelUrl, modelUrl, modelUrl]);
});

test('reports unavailable web configuration before calling a chat-only provider', async t => {
  const requests = mockUpstream(t, () => assert.fail('Unexpected model invocation'));
  const runtimeEnv = { ALLOWED_ORIGIN: origin, APP_TOKEN: env.APP_TOKEN, AI_PROVIDER: 'openai',
    MODEL: 'fixture-model', OPENAI_API_KEY: 'fixture-chat-key' };
  const res = await ask({ protocol: 2, question, webSearch: true }, { runtimeEnv });
  assert.equal(res.status, 503);
  assert.equal((await res.json()).code, 'web_search_unconfigured');
  assert.deepEqual(requests, []);
});

test('uses only the opted-in question to find a source, then reads and cites the registered original', async t => {
  const shipmentMarker = 'shipment-confidential-fixture';
  const reportMarker = 'report-confidential-fixture';
  const historyMarker = 'history-confidential-fixture';
  const answer = 'CBP describes the importer’s reasonable-care obligation. [w1]';
  const requests = mockUpstream(t, (body, turn) => {
    assert.ok(toolNames(body).includes('web_search'));
    assert.ok(toolNames(body).includes('read_page'));
    if (turn === 0) {
      const context = JSON.parse(body.messages.at(-1).content);
      assert.deepEqual(context.shipment, { product: shipmentMarker });
      assert.deepEqual(context.report, { note: reportMarker });
      return reply(null, [toolCall('search', 'web_search')]);
    }
    if (turn === 1) {
      const result = toolResult(body, 'search');
      assert.equal(result?.status, 'ok');
      assert.match(JSON.stringify(result.data), /Look up CBP importer guidance/);
      assert.deepEqual(result.sources.map(({ id, url, method, kind, publishedAt }) => ({ id, url, method, kind, publishedAt })), [
        { id: 'w1', url: sourceUrl, method: 'search', kind: 'reference', publishedAt: '2026-11-01' },
      ]);
      return reply(null, [toolCall('read', 'read_page', { sourceId: 'w1' })]);
    }
    assert.equal(turn, 2);
    const result = toolResult(body, 'read');
    assert.equal(result?.status, 'ok');
    assert.match(JSON.stringify(result.data), /exercise reasonable care/);
    assert.deepEqual(result.sources.map(({ id, url, method }) => ({ id, url, method })), [
      { id: 'w1', url: sourceUrl, method: 'page' },
    ]);
    return reply(answer);
  });

  const res = await ask({
    protocol: 2, question, webSearch: true, shipment: { product: shipmentMarker }, report: { note: reportMarker },
    history: [{ role: 'user', content: historyMarker }],
  });
  assert.equal(res.status, 200);
  const result = await res.json();
  assert.equal(result.answer, answer);
  assert.deepEqual(result.steps, [{ name: 'web_search', status: 'ok' }, { name: 'read_page', status: 'ok' }]);
  assert.equal(result.sources.length, 1);
  const [source] = result.sources;
  assert.equal(source.id, 'w1');
  assert.equal(source.url, sourceUrl);
  assert.equal(source.title, sourceTitle);
  assert.equal(source.method, 'page');
  assert.equal(source.kind, 'lookup');
  assert.ok(Number.isFinite(Date.parse(source.retrievedAt)));

  assert.deepEqual(requests.map(request => request.url), [modelUrl, searchUrl, modelUrl, readerUrl, modelUrl]);
  const search = requests[1];
  const read = requests[3];
  assert.equal(search.body.search_query, question);
  assert.equal(search.body.search_engine, 'search_std');
  assert.equal(read.body.url, sourceUrl);
  for (const request of [search, read]) {
    assert.equal(request.method, 'POST');
    assert.equal(request.headers.get('Authorization'), `Bearer ${env.ZHIPU_API_KEY}`);
    const raw = JSON.stringify(request.body);
    for (const marker of [shipmentMarker, reportMarker, historyMarker, env.APP_TOKEN]) {
      assert.equal(raw.includes(marker), false);
    }
  }
  assert.equal(JSON.stringify(result).includes(env.ZHIPU_API_KEY), false);
});

test('rejects a model-supplied search query, a literal page URL, and an unregistered source ID', async t => {
  const requests = mockUpstream(t, (body, turn) => {
    if (turn === 0) return reply(null, [
      toolCall('query', 'web_search', { query: 'unsolicited search' }),
      toolCall('url', 'read_page', { url: 'https://unsolicited.example/page' }),
      toolCall('known', 'web_search'),
      toolCall('unregistered', 'read_page', { sourceId: 'w9' }),
    ]);
    assert.equal(turn, 1);
    for (const id of ['query', 'url', 'unregistered']) assert.equal(toolResult(body, id)?.status, 'denied');
    assert.equal(toolResult(body, 'known')?.status, 'ok');
    return reply('找到了相关索引。[w1]');
  });

  const res = await ask({ protocol: 2, question, webSearch: true });
  assert.equal(res.status, 200);
  const result = await res.json();
  assert.deepEqual(result.steps, [
    { name: 'web_search', status: 'denied' },
    { name: 'read_page', status: 'denied' },
    { name: 'web_search', status: 'ok' },
    { name: 'read_page', status: 'denied' },
  ]);
  assert.deepEqual(result.sources.map(({ id, url, method }) => ({ id, url, method })), [
    { id: 'w1', url: sourceUrl, method: 'search' },
  ]);
  assert.deepEqual(requests.map(request => request.url), [modelUrl, searchUrl, modelUrl]);
});

test('keeps source IDs within their originating request', async t => {
  const requests = mockUpstream(t, (body, turn) => {
    if (turn === 0) return reply(null, [toolCall('new-search', 'web_search')]);
    if (turn === 1) return reply('找到索引。[w1]');
    if (turn === 2) return reply(null, [toolCall('previous-read', 'read_page', { sourceId: 'w1' })]);
    assert.equal(turn, 3);
    assert.equal(toolResult(body, 'previous-read')?.status, 'denied');
    return reply('本次没有可读取来源。');
  });

  const first = await ask({ protocol: 2, question, webSearch: true });
  assert.equal(first.status, 200);
  assert.equal((await first.json()).sources[0]?.id, 'w1');

  const second = await ask({ protocol: 2, question, webSearch: true });
  assert.equal(second.status, 200);
  assert.deepEqual((await second.json()).sources, []);
  assert.deepEqual(requests.map(request => request.url), [modelUrl, searchUrl, modelUrl, modelUrl, modelUrl]);
});

test('preserves search-only provenance when a registered page cannot be retrieved', async t => {
  const requests = mockUpstream(t, (body, turn) => {
    if (turn === 0) return reply(null, [toolCall('search', 'web_search')]);
    if (turn === 1) return reply(null, [toolCall('read', 'read_page', { sourceId: 'w1' })]);
    assert.equal(turn, 2);
    assert.equal(toolResult(body, 'read')?.status, 'unavailable');
    return reply('暂时只能核对搜索摘要。[w1]');
  }, { reader: () => new Response('fixture provider error', { status: 429 }) });

  const res = await ask({ protocol: 2, question, webSearch: true });
  assert.equal(res.status, 200);
  const result = await res.json();
  assert.deepEqual(result.steps, [{ name: 'web_search', status: 'ok' }, { name: 'read_page', status: 'unavailable' }]);
  assert.deepEqual(result.sources.map(({ id, method, kind }) => ({ id, method, kind })), [
    { id: 'w1', method: 'search', kind: 'reference' },
  ]);
  assert.equal(JSON.stringify(result).includes('fixture provider error'), false);
  assert.deepEqual(requests.map(request => request.url), [modelUrl, searchUrl, modelUrl, readerUrl, modelUrl]);
});

test('keeps cited web evidence when other reference links already fill the response limit', async t => {
  const requests = mockUpstream(t, (body, turn) => {
    if (turn === 0) return reply(null, [
      toolCall('customs', 'official_sources', { topic: 'customs' }),
      toolCall('sanctions', 'official_sources', { topic: 'sanctions' }),
      toolCall('origin', 'official_sources', { topic: 'origin' }),
      toolCall('search', 'web_search'),
    ]);
    assert.equal(turn, 1);
    const referenceUrls = ['customs', 'sanctions', 'origin']
      .flatMap(id => toolResult(body, id).sources.map(source => source.url));
    assert.ok(new Set(referenceUrls).size >= 8);
    return reply('索引指向美国海关的进口指南。[w1]');
  });

  const res = await ask({ protocol: 2, question, webSearch: true });
  assert.equal(res.status, 200);
  const result = await res.json();
  assert.equal(result.sources.length, 8);
  assert.equal(result.sources[0].id, 'w1');
  assert.equal(result.sources[0].url, sourceUrl);
  assert.deepEqual(requests.map(request => request.url), [modelUrl, searchUrl, modelUrl]);
});
