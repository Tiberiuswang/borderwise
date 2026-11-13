import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.mjs';

const origin = 'https://demo.github.io';
const env = {
  ALLOWED_ORIGIN: origin,
  APP_TOKEN: 'private-app-token-123',
  OPENAI_API_KEY: 'private-provider-key-456',
};

function req(body = { question: '需要准备什么材料？', shipment: { goods: '玩具' }, report: null }, options = {}) {
  return new Request('https://worker.example/', {
    method: options.method || 'POST',
    headers: options.headers || {
      Origin: origin,
      Authorization: `Bearer ${env.APP_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: (options.method === 'OPTIONS' || options.method === 'GET') ? undefined :
      (typeof body === 'string' ? body : JSON.stringify(body)),
  });
}

async function withFetch(fake, fn) {
  const original = globalThis.fetch;
  globalThis.fetch = fake;
  try { return await fn(); } finally { globalThis.fetch = original; }
}

async function json(response) { return response.json(); }

test('exact origin only, valid preflight, and fail-closed configuration', async () => {
  let r = await worker.fetch(req(null, { method: 'OPTIONS', headers: { Origin: origin } }), env);
  assert.equal(r.status, 204);
  assert.equal(r.headers.get('access-control-allow-origin'), origin);
  assert.match(r.headers.get('access-control-allow-headers'), /Authorization/i);
  assert.match(r.headers.get('vary'), /Origin/i);
  for (const bad of ['https://evil.example', 'https://demo.github.io.evil.example', 'null', '']) {
    r = await worker.fetch(req({}, { headers: { Origin: bad } }), env);
    assert.equal(r.status, 403);
    assert.equal(r.headers.get('access-control-allow-origin'), null);
  }
  r = await worker.fetch(req(), { ...env, ALLOWED_ORIGIN: `${origin}/` });
  assert.equal(r.status, 500);
  assert.equal(r.headers.get('access-control-allow-origin'), null);
  r = await worker.fetch(req(null, { method: 'GET', headers: { Origin: origin } }), env);
  assert.equal(r.status, 405);
});

test('requires configured secrets and validates bearer token before upstream', async () => {
  let calls = 0;
  await withFetch(async () => { calls++; throw Error('unexpected'); }, async () => {
    let r = await worker.fetch(req(), { ...env, OPENAI_API_KEY: '' });
    assert.equal(r.status, 500);
    r = await worker.fetch(req({}, { headers: { Origin: origin, Authorization: 'Bearer wrong', 'Content-Type': 'application/json' } }), env);
    assert.equal(r.status, 401);
    assert.equal(r.headers.get('access-control-allow-origin'), origin);
    assert.equal(calls, 0);
  });
});

test('rejects malformed, oversized, and invalid inputs', async () => {
  let r = await worker.fetch(req('{'), env);
  assert.equal(r.status, 400);
  r = await worker.fetch(req({}, { headers: { Origin: origin, Authorization: `Bearer ${env.APP_TOKEN}`, 'Content-Type': 'text/plain' } }), env);
  assert.equal(r.status, 415);
  r = await worker.fetch(req('x'.repeat(65537)), env);
  assert.equal(r.status, 413); // actual streamed bytes, independent of Content-Length
  r = await worker.fetch(req({ question: 'x'.repeat(2001) }), env);
  assert.equal(r.status, 400);
  r = await worker.fetch(req({ question: ' ', shipment: {} }), env);
  assert.equal(r.status, 400);
  r = await worker.fetch(req({ question: 'q', shipment: 'x'.repeat(16384) }), env);
  assert.equal(r.status, 400); // JSON quotes count against the context limit
  r = await worker.fetch(req({ question: 'q', report: 'x'.repeat(32768) }), env);
  assert.equal(r.status, 400);
  r = await worker.fetch(req({ question: 'q', report: 2 }), env);
  assert.equal(r.status, 400);
});

test('sends Zhipu (OpenAI-compatible) request and returns only answer', async () => {
  await withFetch(async (url, init) => {
    assert.equal(url, 'https://open.bigmodel.cn/api/paas/v4/chat/completions');
    assert.equal(init.redirect, 'manual');
    assert.equal(init.headers.Authorization, `Bearer ${env.OPENAI_API_KEY}`);
    assert.equal(init.body.includes(env.APP_TOKEN), false);
    const sent = JSON.parse(init.body);
    assert.equal(sent.model, 'glm-4.7-flash');
    assert.equal('thinking' in sent, false);
    assert.equal(sent.stream, false);
    assert.match(sent.messages[0].content, /不得伪造/);
    assert.match(sent.messages[0].content, /没有实时查询工具/);
    assert.deepEqual(JSON.parse(sent.messages[1].content).shipment, { goods: '玩具' });
    return Response.json({ choices: [{ message: { content: '  请查验官方资料。  ' } }], provider_private_data: 'do not return' });
  }, async () => {
    const r = await worker.fetch(req(), env);
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('access-control-allow-origin'), origin);
    assert.deepEqual(await json(r), { answer: '请查验官方资料。' });
  });
});

test('public access mode skips app token but keeps provider secret server-side', async () => {
  const publicEnv = { ...env, PUBLIC_ACCESS: 'true' };
  delete publicEnv.APP_TOKEN;
  await withFetch(async (url, init) => {
    assert.equal(init.headers.Authorization, `Bearer ${env.OPENAI_API_KEY}`);
    return Response.json({ choices: [{ message: { content: '公开模式仍需人工核验。' } }] });
  }, async () => {
    const r = await worker.fetch(req(undefined, { headers: { Origin: origin, 'Content-Type': 'application/json' } }), publicEnv);
    assert.equal(r.status, 200);
    assert.deepEqual(await json(r), { answer: '公开模式仍需人工核验。' });
  });
});

test('redacts literal configured secrets from answers', async () => {
  await withFetch(async () => Response.json({ choices: [{ message: { content: `${env.OPENAI_API_KEY} ${env.APP_TOKEN}` } }] }), async () => {
    const r = await worker.fetch(req(), env);
    assert.deepEqual(await json(r), { answer: '[已隐藏] [已隐藏]' });
  });
});

test('sanitizes provider errors and invalid provider response', async () => {
  for (const upstream of [new Response(`secret error: ${env.OPENAI_API_KEY}`, { status: 401 }), new Response('not json')]) {
    await withFetch(async () => upstream, async () => {
      const r = await worker.fetch(req(), env);
      assert.equal(r.status, 502);
      const text = await r.text();
      assert.equal(text.includes(env.OPENAI_API_KEY), false);
      assert.equal(text.includes('secret error'), false);
      assert.equal(text.includes('not json'), false);
    });
  }
  const r = await worker.fetch(req(), { ...env, OPENAI_BASE_URL: 'http://insecure.example/v1' });
  assert.equal(r.status, 500);
});

test('aborts a stalled upstream request and returns a clean timeout', async () => {
  const originalTimer = globalThis.setTimeout;
  globalThis.setTimeout = (fn) => originalTimer(fn, 1);
  try {
    await withFetch((url, init) => new Promise((resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(new Error('private upstream details')));
    }), async () => {
      const r = await worker.fetch(req(), env);
      assert.equal(r.status, 504);
      assert.deepEqual(await json(r), { error: '模型服务请求超时，请稍后重试。' });
    });
  } finally {
    globalThis.setTimeout = originalTimer;
  }
});

test('prefers ZHIPU_API_KEY, honours THINKING and ZHIPU_BASE_URL', async () => {
  const zEnv = { ALLOWED_ORIGIN: origin, APP_TOKEN: env.APP_TOKEN, ZHIPU_API_KEY: 'zhipu-key-789', THINKING: 'disabled', ZHIPU_BASE_URL: 'https://api.z.ai/api/paas/v4' };
  await withFetch(async (url, init) => {
    assert.equal(url, 'https://api.z.ai/api/paas/v4/chat/completions');
    assert.equal(init.headers.Authorization, 'Bearer zhipu-key-789');
    assert.deepEqual(JSON.parse(init.body).thinking, { type: 'disabled' });
    return Response.json({ choices: [{ message: { content: 'ok' } }] });
  }, async () => {
    const r = await worker.fetch(req(), zEnv);
    assert.equal(r.status, 200);
  });
});
