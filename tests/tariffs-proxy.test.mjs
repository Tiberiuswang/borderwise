import test from 'node:test';
import assert from 'node:assert/strict';
import { onRequestGet } from '../functions/api/tariffs/us.js';

const requestFor = code => new Request(`https://example.com/api/tariffs/us?code=${encodeURIComponent(code)}`);

test('US tariff proxy accepts only digits and always fetches a fixed USITC range', async t => {
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => Response.json([{ htsno: '6109.10.00' }]));
  const invalid = await onRequestGet({ request: requestFor('https://example.com/') });
  assert.equal(invalid.status, 400);
  assert.equal(fetchMock.mock.callCount(), 0);

  for (const [code, from, to] of [
    ['610910', '6109.10', '6109.10.99.99'],
    ['61091000', '6109.10.00', '6109.10.00.99'],
    ['6109100010', '6109.10.00', '6109.10.00.99'],
  ]) {
    const response = await onRequestGet({ request: requestFor(code) });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), [{ htsno: '6109.10.00' }]);
    const [url, options] = fetchMock.mock.calls.at(-1).arguments;
    assert.equal(url.origin + url.pathname, 'https://hts.usitc.gov/reststop/exportList');
    assert.equal(url.searchParams.get('from'), from);
    assert.equal(url.searchParams.get('to'), to);
    assert.equal(options.redirect, 'error');
  }
});

test('US tariff proxy reports an upstream error instead of publishing unverified data', async t => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({ unexpected: true }));
  const response = await onRequestGet({ request: requestFor('610910') });
  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), { error: 'usitc_unavailable' });
});

test('US proxy cancels a response that exceeds the byte limit without a content length', async t => {
  let canceled = false;
  const body = new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array(1024 * 1024 + 1)); },
    cancel() { canceled = true; },
  });
  t.mock.method(globalThis, 'fetch', async () => new Response(body));
  const response = await onRequestGet({ request: requestFor('610910') });
  assert.equal(response.status, 502);
  assert.equal(canceled, true);
});
