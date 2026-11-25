import assert from 'node:assert/strict';
import test from 'node:test';
import { createSessionStore } from '../docs/session-store.js';

const key = 'borderwise-agent-session-v1';
const endpoint = 'https://worker.example/agent';

function memoryStorage() {
  const entries = new Map();
  return {
    getItem: name => entries.get(name) ?? null,
    setItem: (name, value) => entries.set(name, value),
    removeItem: name => entries.delete(name),
  };
}

function aiTurn(question, answer = '请核对随附资料。', scope = endpoint) {
  return { question, answer, mode: 'ai', scope };
}

test('restores complete tab-local turns across reload and clears the saved session', () => {
  const storage = memoryStorage();
  const first = createSessionStore(storage);
  assert.equal(first.append(aiTurn('查看报关资料')), true);
  assert.equal(first.append({ question: '本地复核', answer: '请核对资料。', mode: 'local' }), true);
  assert.equal(first.append({ question: '进行中的问题', mode: 'ai' }), false);
  const reloaded = createSessionStore(storage);
  assert.deepEqual(reloaded.turns(), first.turns());
  assert.deepEqual(reloaded.history(endpoint), [
    { role: 'user', content: '查看报关资料' },
    { role: 'assistant', content: '请核对随附资料。' },
  ]);
  assert.equal(reloaded.clear(), true);
  assert.deepEqual(reloaded.turns(), []);
  assert.equal(storage.getItem(key), null);
  assert.deepEqual(createSessionStore(storage).turns(), []);
});

test('model history contains only the most recent complete AI pairs for the same endpoint', () => {
  const session = createSessionStore(null);
  for (let index = 1; index <= 6; index++) session.append(aiTurn(`Q${index}`, `A${index}`));
  session.append(aiTurn('不同地址', '不能发送给另一个地址', 'https://worker.example/another'));
  session.append({ question: '离线问题', answer: '仅本地可看', mode: 'local', scope: endpoint });
  assert.deepEqual(session.history(endpoint), [
    { role: 'user', content: 'Q3' }, { role: 'assistant', content: 'A3' },
    { role: 'user', content: 'Q4' }, { role: 'assistant', content: 'A4' },
    { role: 'user', content: 'Q5' }, { role: 'assistant', content: 'A5' },
    { role: 'user', content: 'Q6' }, { role: 'assistant', content: 'A6' },
  ]);
  assert.deepEqual(session.history('https://other.example'), []);
});

test('limits transcript length and keeps model context within its UTF-8 byte budget', () => {
  const session = createSessionStore(null);
  for (let index = 1; index <= 14; index++) session.append(aiTurn(`Q${index}`, '中'.repeat(500)));
  assert.equal(session.turns().length, 12);
  assert.equal(session.turns()[0].question, 'Q3');
  const history = session.history(endpoint);
  assert.deepEqual(history.filter(message => message.role === 'user').map(message => message.content), ['Q14']);
  assert.equal(history.length % 2, 0);
  assert.ok(new TextEncoder().encode(JSON.stringify(history)).length <= 3 * 1024);
  session.append(aiTurn('货'.repeat(3000), '答'.repeat(20_000)));
  const latest = session.turns().at(-1);
  assert.equal(latest.question.length, 2000);
  assert.equal(latest.answer.length, 16_000);
  const compacted = session.history(endpoint);
  assert.deepEqual(compacted.map(message => message.role), ['user', 'assistant']);
  for (const [message, original] of [[compacted[0], latest.question], [compacted[1], latest.answer]]) {
    assert.ok(message.content.endsWith('…'));
    assert.ok(original.startsWith(message.content.slice(0, -1)));
  }
  assert.ok(new TextEncoder().encode(JSON.stringify(compacted)).length <= 3 * 1024);
});

test('excludes secrets and unsafe evidence from storage and the model history', () => {
  const storage = memoryStorage();
  const session = createSessionStore(storage);
  session.append({
    ...aiTurn('海关税率', '请查官方资料', endpoint + '?secret=scope-secret'),
    authorization: 'Bearer worker-secret',
    providerKey: 'provider-secret',
    steps: [{ name: 'lookup_tariff', status: 'ok', raw: 'trace-secret' }, { status: 'ok' }],
    sources: [
      { title: '海关', url: 'https://www.trade-tariff.service.gov.uk/commodities/123', kind: 'lookup', retrievedAt: '2026-11-21T12:00:00.000Z' },
      { title: '安全条款', url: 'javascript:alert(1)', kind: 'reference' },
      { title: '不安全协议', url: 'http://example.org', kind: 'lookup' },
      { title: '带凭据地址', url: 'https://user:url-secret@example.org', kind: 'lookup' },
      { title: '无效类型', url: 'https://example.org', kind: 'unknown' },
    ],
  });
  assert.deepEqual(session.turns()[0], {
    question: '海关税率',
    answer: '请查官方资料',
    mode: 'ai',
    steps: [{ name: 'lookup_tariff', status: 'ok' }],
    sources: [{
      title: '海关',
      url: 'https://www.trade-tariff.service.gov.uk/commodities/123',
      kind: 'lookup',
      retrievedAt: '2026-11-21T12:00:00.000Z',
    }],
  });
  assert.doesNotMatch(storage.getItem(key), /secret|javascript:/);
  assert.deepEqual(session.history(endpoint + '?secret=scope-secret'), []);
  assert.deepEqual(session.history(endpoint), []);
});

test('keeps only safe web citation metadata in reloaded turns', () => {
  const storage = memoryStorage();
  const search = {
    id: 'w1', method: 'search', kind: 'reference', title: '搜索结果', url: 'https://example.org/result',
    publishedAt: '2026-11-20', retrievedAt: '2026-11-21T12:00:00.000Z',
  };
  const page = { id: 'w103', method: 'page', kind: 'lookup', title: '原文', url: 'https://example.org/page' };
  const legacy = { kind: 'reference', title: '官方入口', url: 'https://example.org/official' };
  createSessionStore(storage).append({
    ...aiTurn('网上有什么资料', '请核对 [w1] 和 [w103]。'),
    sources: [
      { ...search, snippet: 'unpersisted snippet', content: 'unpersisted source body' },
      { ...page, publishedAt: 'unknown date' },
      { ...page, id: 'w1', url: 'https://example.org/duplicate' },
      { ...page, id: 'w3', url: 'javascript:alert(1)' },
      { ...page, id: 'w4', url: `https://example.org/${'货'.repeat(100)}` },
      { ...legacy, id: 'w5', method: 'page', publishedAt: '2026-11-20' },
      { ...search, id: 'w01', url: 'https://example.org/no-citation' },
    ],
  });
  const { id, ...searchWithoutId } = search;
  assert.deepEqual(createSessionStore(storage).turns()[0].sources, [
    search, page, legacy, { ...searchWithoutId, url: 'https://example.org/no-citation' },
  ]);
  assert.doesNotMatch(storage.getItem(key), /unpersisted|javascript|duplicate|unknown date/);
});

test('isolates malformed or unsupported saved state and snapshots cannot mutate it', () => {
  const storage = memoryStorage();
  for (const raw of ['broken JSON', '["array"]', '{"version":2,"turns":[]}', '{"version":1,"turns":{}}']) {
    storage.setItem(key, raw);
    assert.deepEqual(createSessionStore(storage).turns(), []);
  }
  storage.setItem(key, JSON.stringify({ version: 1, turns: [null, aiTurn('有效问答'), {}] }));
  const session = createSessionStore(storage);
  const snapshot = session.turns();
  snapshot[0].question = '错误';
  assert.equal(session.turns()[0].question, '有效问答');
});

test('filters an access token echoed inside evidence metadata', () => {
  const storage = memoryStorage();
  const session = createSessionStore(storage);
  const token = 'secret/token"123';
  const official = { title: '官方税则', url: 'https://example.org/official', kind: 'reference' };
  session.append({
    ...aiTurn('查询关税'),
    steps: [{ name: 'lookup_tariff', status: 'ok' }, { name: token, status: 'ok' }],
    sources: [official, { ...official, title: `引用 ${token}` },
      { ...official, url: `https://example.org/?q=${encodeURIComponent(token)}` }],
  }, token);
  assert.deepEqual(session.turns()[0].sources, [official]);
  assert.deepEqual(session.turns()[0].steps, [{ name: 'lookup_tariff', status: 'ok' }]);
  assert.equal(storage.getItem(key).includes(encodeURIComponent(token)), false);
});

test('falls back to memory when storage is blocked and can replace a failed removal with empty state', () => {
  const blocked = () => { throw new Error('storage blocked'); };
  const disabled = createSessionStore({ getItem: blocked, setItem: blocked, removeItem: blocked });
  assert.ok(disabled.append(aiTurn('本地暂存')));
  assert.equal(disabled.turns().length, 1);
  assert.equal(disabled.clear(), false);
  assert.deepEqual(disabled.turns(), []);

  const storage = { ...memoryStorage(), removeItem: blocked };
  const session = createSessionStore(storage);
  session.append(aiTurn('以前的记录'));
  assert.equal(session.clear(), true);
  assert.deepEqual(createSessionStore(storage).turns(), []);
});
