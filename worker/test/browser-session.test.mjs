import test from 'node:test';
import assert from 'node:assert/strict';
import { onRequest as pagesAi } from '../../functions/api/ai.js';
import { issueBrowserSession, verifyBrowserSession } from '../src/domain/browser-session.mjs';
import worker from '../src/index.mjs';

const origin = 'https://borderwise.example';
const route = origin + '/api/ai';
const appToken = 'test-only-app-passphrase';
const providerKey = 'test-only-provider-key';
const secret = 'test-only-signing-key';
const config = { origin, appToken, secret };
const env = { ALLOWED_ORIGIN: origin, APP_TOKEN: appToken, ZHIPU_API_KEY: providerKey };
const now = Date.parse('2026-11-25T00:00:00Z');
const ttl = 30 * 86_400;

function request(payload, { url = route, requestOrigin = origin, bearer, cookie } = {}) {
  const headers = new Headers({ Origin: requestOrigin, 'Content-Type': 'application/json' });
  if (bearer !== undefined) headers.set('Authorization', 'Bearer ' + bearer);
  if (cookie !== undefined) headers.set('Cookie', cookie);
  return new Request(url, { method: 'POST', headers, body: JSON.stringify(payload) });
}

function cookiePair(header) {
  return header.split(';', 1)[0];
}

async function withFetch(fetchImpl, run) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fetchImpl;
  try { return await run(); } finally { globalThis.fetch = originalFetch; }
}

test('session cookies use random nonces with bounded signed expiry and host-only attributes', async () => {
  const issued = await issueBrowserSession(config, now);
  const other = await issueBrowserSession(config, now);
  const cookie = cookiePair(issued);
  assert.notEqual(other, issued);
  assert.match(cookie, /^__Host-borderwise-ai=v1\.[0-9]+\.[\w-]{22}\.[\w-]{43}$/);
  assert.doesNotMatch(issued, /test-only|Domain=/);
  for (const attribute of ['Path=/', 'Secure', 'HttpOnly', 'SameSite=Strict', 'Max-Age=' + ttl]) {
    assert.ok(issued.split('; ').includes(attribute));
  }
  const incoming = request({}, { cookie: 'another_cookie=ok; ' + cookie });
  assert.equal(await verifyBrowserSession(incoming, config, now), true);
  assert.equal(await verifyBrowserSession(incoming, config, now + (ttl * 1000) - 1), true);
  assert.equal(await verifyBrowserSession(incoming, config, now + (ttl * 1000)), false);
});

test('session verification fails closed on tampering, secret changes and oversized or ambiguous cookies', async () => {
  const cookie = cookiePair(await issueBrowserSession(config, now));
  const signatureIndex = cookie.lastIndexOf('.') + 1;
  const replacement = cookie[signatureIndex] === 'A' ? 'B' : 'A';
  const tampered = cookie.slice(0, signatureIndex) + replacement + cookie.slice(signatureIndex + 1);
  assert.equal(await verifyBrowserSession(request({}, { cookie: tampered }), config, now), false);
  assert.equal(await verifyBrowserSession(request({}, { cookie }), { ...config, appToken: 'different' }, now), false);
  assert.equal(await verifyBrowserSession(request({}, { cookie }), { ...config, secret: 'different' }, now), false);
  assert.equal(await verifyBrowserSession(request({}, { cookie: cookie + '; ' + cookie }), config, now), false);
  assert.equal(await verifyBrowserSession(request({}, { cookie: 'huge=' + 'x'.repeat(8 * 1024) + '; ' + cookie }), config, now), false);
  const newOrigin = 'https://second.example';
  const incoming = request({}, { url: newOrigin + '/api/ai', requestOrigin: newOrigin, cookie });
  assert.equal(await verifyBrowserSession(incoming, { ...config, origin: newOrigin }, now), false);
});

test('only the exact same-origin HTTPS path and origin can use a signed cookie', async () => {
  const cookie = cookiePair(await issueBrowserSession(config, now));
  for (const options of [
    { url: route + '/' },
    { url: route + '?mode=test' },
    { url: origin + '/' },
    { url: 'http://borderwise.example/api/ai' },
    { requestOrigin: 'https://other.example' },
    { url: 'https://worker.example/api/ai' },
  ]) {
    assert.equal(await verifyBrowserSession(request({}, { cookie, ...options }), config, now), false);
  }
});

test('same-origin a valid Bearer starts a session through the Pages binding without invoking the provider', async () => {
  const binding = { fetch: next => worker.fetch(next, env) };
  const throughPages = (payload, options) => pagesAi({
    request: request(payload, options), env: { BORDERWISE_AI: binding },
  });
  await withFetch(() => assert.fail('session actions must not contact the provider'), async () => {
    const connected = await throughPages({ action: 'verify_token' }, { bearer: appToken });
    assert.equal(connected.status, 200);
    assert.deepEqual(await connected.json(), { verified: true });
    assert.equal(connected.headers.get('cache-control'), 'no-store');
    const cookie = cookiePair(connected.headers.get('set-cookie'));
    for (const options of [{ cookie }, { cookie, bearer: 'wrong' }]) {
      const auth = await throughPages({ action: 'verify_token' }, options);
      assert.equal(auth.status, 401);
      assert.equal(auth.headers.get('set-cookie'), null);
    }
    const active = await throughPages({ action: 'session_status' }, { cookie });
    assert.equal(active.status, 200);
    assert.deepEqual(await active.json(), { connected: true });
    const freshBrowser = await throughPages({ action: 'session_status' }, { bearer: appToken });
    assert.deepEqual(await freshBrowser.json(), { connected: false });
    const signedOut = await throughPages({ action: 'sign_out' }, { cookie });
    assert.equal(signedOut.status, 200);
    assert.deepEqual(await signedOut.json(), { connected: false });
    assert.match(signedOut.headers.get('set-cookie'), /^__Host-borderwise-ai=; .*Max-Age=0/);
    const afterSignout = await throughPages({ action: 'session_status' }, { cookie: cookiePair(signedOut.headers.get('set-cookie')) });
    assert.deepEqual(await afterSignout.json(), { connected: false });
  });
});

test('cookie authenticates same-origin questions and is never forwarded to the provider', async () => {
  const verified = await worker.fetch(request({ action: 'verify_token' }, { bearer: appToken }), env);
  const cookie = cookiePair(verified.headers.get('set-cookie'));
  let calls = 0;
  await withFetch(async (_url, options) => {
    calls++;
    assert.equal(options.headers.Authorization, 'Bearer ' + providerKey);
    assert.equal(new Headers(options.headers).get('Cookie'), null);
    assert.doesNotMatch(options.body, /test-only-app-passphrase|__Host-borderwise-ai/);
    return Response.json({ choices: [{ message: { content: 'Authenticated answer.' } }] });
  }, async () => {
    const payload = { question: '问一个问题' };
    const success = await worker.fetch(request(payload, { cookie }), env);
    assert.equal(success.status, 200);
    assert.deepEqual(await success.json(), { answer: 'Authenticated answer.' });
    const explicitBadBearer = await worker.fetch(request(payload, { cookie, bearer: 'wrong' }), env);
    assert.equal(explicitBadBearer.status, 401);
    const foreign = await worker.fetch(request(payload, { url: 'https://worker.example/api/ai', cookie }), env);
    assert.equal(foreign.status, 401);
    const crossOrigin = await worker.fetch(request(payload, { cookie, requestOrigin: 'https://other.example' }), env);
    assert.equal(crossOrigin.status, 403);
    assert.equal(calls, 1);
  });
});

test('direct Bearer verification remains compatible and cross-origin requests cannot set or clear cookies', async () => {
  const toWorker = { url: 'https://worker.example/', bearer: appToken };
  const checked = await worker.fetch(request({ action: 'verify_token' }, toWorker), env);
  assert.equal(checked.status, 200);
  assert.deepEqual(await checked.json(), { verified: true });
  assert.equal(checked.headers.get('set-cookie'), null);
  for (const action of ['session_status', 'sign_out']) {
    const rejected = await worker.fetch(request({ action }, toWorker), env);
    assert.equal(rejected.status, 403);
    assert.equal(rejected.headers.get('set-cookie'), null);
  }
});

test('the optional signing secret survives provider rotation but not app-token or signing-secret rotation', async () => {
  const dedicatedEnv = { ...env, AI_SESSION_SECRET: secret };
  const verified = await worker.fetch(request({ action: 'verify_token' }, { bearer: appToken }), dedicatedEnv);
  const cookie = cookiePair(verified.headers.get('set-cookie'));
  const status = options => worker.fetch(request({ action: 'session_status' }, { cookie }), options);
  assert.deepEqual(await (await status({ ...dedicatedEnv, ZHIPU_API_KEY: 'new-test-provider-key' })).json(), { connected: true });
  assert.deepEqual(await (await status({ ...dedicatedEnv, APP_TOKEN: 'new-test-app-token' })).json(), { connected: false });
  assert.deepEqual(await (await status({ ...dedicatedEnv, AI_SESSION_SECRET: 'new-test-session-key' })).json(), { connected: false });
  assert.deepEqual(await (await status({ ...dedicatedEnv, PUBLIC_ACCESS: 'true' })).json(), { connected: false });
  const noProvider = await status({ ...dedicatedEnv, ZHIPU_API_KEY: '' });
  assert.equal(noProvider.status, 200);
  assert.deepEqual(await noProvider.json(), { connected: false });
});
