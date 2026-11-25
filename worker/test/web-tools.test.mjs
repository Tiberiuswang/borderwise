import test from 'node:test';
import assert from 'node:assert/strict';
import { createWebTools } from '../src/adapters/web-tools.mjs';

const BIGMODEL = 'https://open.bigmodel.cn/api/paas/v4';
const TAVILY = 'https://api.tavily.com';
const PRIVATE_TOKEN = 'test-app-token-never-share';
const PRIVATE_API_KEY = 'test-zhipu-key';
const env = { ZHIPU_API_KEY: PRIVATE_API_KEY, APP_TOKEN: PRIVATE_TOKEN };
const sourceUrl = 'https://www.cbp.gov/trade/port-updates';

function tools(options) {
  const [search, read] = createWebTools(options);
  return { search, read };
}

function searchRow(link, extras = {}) {
  return { title: 'Port notice', link, content: 'Statement from the port.', publish_date: '2026-11-01', ...extras };
}

test('registers tools only for Tavily or a BigModel-compatible configuration', () => {
  for (const unsupported of [
    {}, { AI_PROVIDER: 'openai', OPENAI_API_KEY: 'test-openai-key' },
    { OPENAI_API_KEY: 'custom-key', OPENAI_BASE_URL: 'https://example.com/api/paas/v4' },
    { OPENAI_API_KEY: 'custom-key', ZHIPU_BASE_URL: BIGMODEL + '?x=wrong' },
  ]) {
    assert.deepEqual(createWebTools({ env: unsupported }), []);
  }
  for (const supported of [
    env,
    { OPENAI_API_KEY: 'legacy-zhipu-key' },
    { AI_PROVIDER: 'zhipu', OPENAI_API_KEY: 'legacy-zhipu-key', ZHIPU_BASE_URL: BIGMODEL + '/' },
    { AI_PROVIDER: 'anthropic', TAVILY_API_KEY: 'test-tavily-key' },
  ]) {
    assert.deepEqual(createWebTools({ env: supported }).map(tool => tool.name), ['web_search', 'read_page']);
  }
});

test('BigModel search only sends bounded current-question keywords to the fixed endpoint', async () => {
  const question = '查询近期港口公告 https://example.com/?access_token=link-secret ' +
    'Bearer secret-bearer private@example.com ' + PRIVATE_TOKEN + ' ' + '海运'.repeat(50);
  const { search, read } = tools({
    env, question,
    async fetchImpl(url, options) {
      assert.equal(url, BIGMODEL + '/web_search');
      assert.equal(options.method, 'POST');
      assert.equal(options.headers.Authorization, 'Bearer ' + PRIVATE_API_KEY);
      assert.equal(options.credentials, 'omit');
      assert.equal(options.redirect, 'manual');
      assert.ok(options.signal instanceof AbortSignal);
      const { search_query, ...params } = JSON.parse(options.body);
      assert.deepEqual(params, { search_engine: 'search_std', search_intent: false, count: 5 });
      assert.ok(search_query.startsWith('查询近期港口公告 海运'));
      assert.ok(search_query.length <= 70);
      assert.doesNotMatch(options.body, /https:|link-secret|example\.com|Bearer|secret-bearer|private-shipment|invented|test-app-token/);
      return Response.json({ search_result: [
        searchRow('https://user:password@www.cbp.gov/'),
        searchRow('https://127.0.0.1/'),
        searchRow('https://[::1]/'),
        searchRow('https://reports.internal/'),
        searchRow('https://127.0.0.1.nip.io/'),
        searchRow('https://example.com/?X-Amz-Signature=signed-value'),
        searchRow(sourceUrl + '#tracking'),
        searchRow(sourceUrl),
        searchRow('https://www.uscg.mil/news', { publish_date: '2026-02-31' }),
      ] });
    },
  });
  assert.equal(read.review({ sourceId: 'w1' }), false);
  const result = await search.execute({ query: 'invented' }, { shipment: { consignee: 'private-shipment' } });
  assert.equal(result.status, 'ok');
  assert.equal(result.sources.length, 2);
  assert.deepEqual(result.data.explicit, []);
  assert.deepEqual(result.data.matches[0], {
    sourceId: 'w1', snippet: 'Statement from the port.', publishedAt: '2026-11-01T00:00:00.000Z',
  });
  assert.equal(result.sources[0].method, 'search');
  assert.equal(result.sources[0].kind, 'reference');
  assert.equal(result.sources[0].url, sourceUrl);
  assert.ok(Number.isFinite(Date.parse(result.sources[0].retrievedAt)));
  assert.equal(result.sources[1].publishedAt, undefined);
  assert.equal(read.review({ sourceId: 'w1' }), true);
  assert.equal(read.review({ sourceId: 'w3' }), false);
  assert.equal((await search.execute({})).status, 'unavailable');
});

test('an explicitly provided public URL can be read by ID before searching', async () => {
  const direct = 'https://example.com/wiki/FOB_(shipping)';
  const finalUrl = 'https://www.example.com/wiki/Free_On_Board';
  const { search, read } = tools({
    env, question: '[查看](' + direct + ')',
    async fetchImpl(url, options) {
      assert.equal(url, BIGMODEL + '/reader');
      assert.deepEqual(JSON.parse(options.body), { url: direct, timeout: 6, return_format: 'text', retain_images: false });
      assert.equal(options.headers.Authorization, 'Bearer ' + PRIVATE_API_KEY);
      assert.equal(options.redirect, 'manual');
      assert.equal(options.credentials, 'omit');
      return Response.json({ reader_result: {
        url: finalUrl, title: 'FOB transport', content: 'FOB means Free on Board. ' + PRIVATE_TOKEN + '\n\u202eSchedule detail.',
      } });
    },
  });

  assert.match(read.description, /编号为 w1/);
  assert.doesNotMatch(read.description, /example\.com/);
  assert.equal(read.review({ sourceId: 'w1' }), true);
  assert.equal(read.review({ sourceId: direct }), false);
  assert.equal((await read.execute({ sourceId: 'w2' })).status, 'needs_input');
  const result = await read.execute({ sourceId: 'w1' });
  assert.equal(result.status, 'ok');
  assert.deepEqual(result.data, { sourceId: 'w1', text: 'FOB means Free on Board. Schedule detail.' });
  assert.deepEqual(result.sources, [{
    id: 'w1', title: 'FOB transport', url: finalUrl, kind: 'lookup', method: 'page',
    retrievedAt: new Date(result.sources[0].retrievedAt).toISOString(),
  }]);

  const onlyLink = tools({ env, question: direct, fetchImpl: () => assert.fail('No keywords to send') });
  const searchable = await onlyLink.search.execute({});
  assert.equal(searchable.status, 'needs_input');
  assert.deepEqual(searchable.data.explicit, [{ sourceId: 'w1', url: direct }]);
  assert.deepEqual(searchable.sources, []);
  assert.ok(search);
});

test('a request can search once and request two distinct page reads', async () => {
  const second = 'https://www.uscg.mil/event';
  const third = 'https://www.gov.uk/customs/records';
  const requests = [];
  const { search, read } = tools({
    env, question: 'Port news today',
    async fetchImpl(url, options) {
      requests.push(url);
      if (url.endsWith('/web_search')) {
        return Response.json({ search_result: [searchRow(sourceUrl), searchRow(second), searchRow(third)] });
      }
      const { url: requested } = JSON.parse(options.body);
      return Response.json({ reader_result: { url: requested, content: 'Public content' } });
    },
  });
  const searchResults = await Promise.all([search.execute({}), search.execute({})]);
  assert.deepEqual(searchResults.map(({ status }) => status), ['ok', 'unavailable']);
  const readResults = await Promise.all(['w1', 'w1', 'w2', 'w3'].map(sourceId => read.execute({ sourceId })));
  assert.deepEqual(readResults.map(({ status }) => status), ['ok', 'unavailable', 'ok', 'unavailable']);
  assert.equal(readResults[0].sources[0].publishedAt, '2026-11-01T00:00:00.000Z');
  assert.deepEqual(requests, [BIGMODEL + '/web_search', BIGMODEL + '/reader', BIGMODEL + '/reader']);
  assert.equal(tools({ env, question: 'Different turn' }).read.review({ sourceId: 'w1' }), false);
});

test('Tavily overrides search and reader only when configured', async () => {
  const calls = [];
  const key = 'test-tavily-key';
  const { search, read } = tools({
    env: { ...env, TAVILY_API_KEY: key }, question: 'Shipping news and ' + sourceUrl,
    async fetchImpl(url, options) {
      calls.push(url);
      assert.equal(options.headers.Authorization, 'Bearer ' + key);
      assert.equal(options.redirect, 'manual');
      const sent = JSON.parse(options.body);
      if (url.endsWith('/search')) {
        assert.deepEqual(sent, { query: 'Shipping news and', max_results: 5, search_depth: 'basic', include_published_date: true });
        return Response.json({ results: [{ url: sourceUrl, title: 'Notice', content: 'Search snippet.' }] });
      }
      assert.deepEqual(sent, {
        urls: [sourceUrl], extract_depth: 'basic', format: 'text', timeout: 6, include_published_date: true,
      });
      return Response.json({ results: [{ url: sourceUrl, raw_content: 'Extracted notice.', published_date: '2026-11-22' }] });
    },
  });
  const searched = await search.execute({});
  assert.equal(searched.sources[0].id, 'w1');
  assert.equal(searched.data.explicit[0].sourceId, 'w1');
  const page = await read.execute({ sourceId: 'w1' });
  assert.equal(page.data.text, 'Extracted notice.');
  assert.equal(page.sources[0].publishedAt, '2026-11-22T00:00:00.000Z');
  assert.deepEqual(calls, [TAVILY + '/search', TAVILY + '/extract']);
});

test('provider HTTP redirects, oversize and unsafe returned pages fail without sources', async () => {
  for (const fakeResponse of [
    new Response(null, { status: 307, headers: { Location: 'https://example.com/' } }),
    new Response('too large', { headers: { 'Content-Length': String(512 * 1024 + 1) } }),
    new Response('x'.repeat(512 * 1024 + 1)),
    Response.json({ reader_result: { url: 'https://127.0.0.1/', content: 'Private response' } }),
    Response.json({ reader_result: { url: sourceUrl, content: '' } }),
  ]) {
    const { read } = tools({
      env, question: sourceUrl,
      async fetchImpl(url, options) {
        assert.equal(url, BIGMODEL + '/reader');
        assert.equal(options.redirect, 'manual');
        return fakeResponse;
      },
    });
    const result = await read.execute({ sourceId: 'w1' });
    assert.equal(result.status, 'unavailable');
    assert.deepEqual(result.sources, []);
    assert.doesNotMatch(JSON.stringify(result), /Private response|test-zhipu-key/);
  }

  const { search } = tools({ env, question: 'Shipping news', fetchImpl: () => assert.fail('Aborted before fetch') });
  await assert.rejects(search.execute({}, {}, AbortSignal.abort()), { name: 'AbortError' });
});

test('large valid excerpts and long URLs stay below the agent evidence limit', async () => {
  const links = Array.from({ length: 7 }, (_, index) =>
    'https://example.com/' + index + '/' + 'x'.repeat(475));
  const { search, read } = tools({
    env, question: '长文新闻 ' + links[0] + ' ' + links[1],
    async fetchImpl(url, options) {
      if (url.endsWith('/web_search')) return Response.json({ search_result: [
        ...links.slice(2).map(link => searchRow(link, { title: '文'.repeat(1000), content: '内'.repeat(1000) })),
      ] });
      return Response.json({ reader_result: { url: JSON.parse(options.body).url, title: '文'.repeat(1000), content: '字'.repeat(10000) } });
    },
  });
  const result = await search.execute({});
  assert.equal(result.sources.length, 5);
  assert.equal(result.sources[4].id, 'w7');
  assert.ok(Buffer.byteLength(JSON.stringify(result)) < 8000);
  const page = await read.execute({ sourceId: 'w7' });
  assert.ok(Buffer.byteLength(JSON.stringify(page)) < 8000);
});
