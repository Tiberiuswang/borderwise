import assert from 'node:assert/strict';
import test from 'node:test';

import {
  compareLogistics, fetchFxRates, FX_CURRENCIES, FX_SOURCE, LOGISTICS_MODES, LOGISTICS_SCOPES,
} from '../docs/logistics.js';

const shipment = { from: '上海仓库', to: '汉堡仓库', load: '1 箱' };
const today = '2026-11-19';
const sample = {
  id: 'sea',
  label: '示例运输方案',
  mode: 'ocean',
  scope: 'door-to-door',
  currency: 'USD',
  freight: '255.50',
  extras: '44.50',
  transitDays: '14',
  handoffs: '1',
  backup: true,
};
const fx = {
  base: 'USD', rates: { EUR: 0.8, JPY: 150 }, dates: { EUR: '2026-11-18', JPY: '2026-11-18' },
};
const flags = result => result.flags.map(flag => flag.code);
const errorFields = result => result.errors.map(error => error.field);
const compare = (quotes, overrides = {}) => compareLogistics({ shipment, quotes, today, baseCurrency: 'USD', ...overrides });

test('compares complete normalized costs, durations and feasible quotes on the same basis', () => {
  const result = compare([
    sample,
    { ...sample, id: 'a', mode: 'air', currency: 'EUR', freight: '800', extras: 0, transitDays: '3' },
    { ...sample, id: 'multimodal', mode: 'multimodal', currency: 'JPY', freight: '55,500', extras: 0, transitDays: '8' },
  ], { deliveryLimitDays: '8', fx });

  assert.deepEqual(Object.keys(LOGISTICS_MODES), ['ocean', 'rail', 'air', 'road', 'multimodal']);
  assert.equal(LOGISTICS_SCOPES['door-to-door'], '门到门');
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.options.map(option => [
    option.id, option.mode, option.currency, option.costTotal, option.convertedTotal, option.fxDate, option.deliveryStatus,
  ]), [
    ['sea', 'ocean', 'USD', 300, 300, null, 'late'],
    ['a', 'air', 'EUR', 800, 1000, '2026-11-18', 'within'],
    ['multimodal', 'multimodal', 'JPY', 55500, 370, '2026-11-18', 'within'],
  ]);
  assert.equal(result.cheapest.id, 'sea');
  assert.equal(result.cheapestWithinLimit.id, 'multimodal');
  assert.equal(result.fastest.id, 'a');
});

test('keeps unknown extras and transit separate from explicit zero', () => {
  const result = compare([
    { ...sample, id: 'incomplete', freight: 20, extras: ' ', transitDays: '' },
    { ...sample, id: 'zero', freight: 20, extras: '0', transitDays: '0' },
  ], { deliveryLimitDays: 0 });
  const [incomplete, zero] = result.options;

  assert.equal(incomplete.extras, null);
  assert.equal(incomplete.costTotal, null);
  assert.equal(incomplete.knownCost, 20);
  assert.equal(incomplete.convertedKnownCost, 20);
  assert.equal(incomplete.convertedTotal, null);
  assert.equal(incomplete.deliveryStatus, 'unknown');
  assert.ok(flags(incomplete).includes('extras-unknown'));
  assert.ok(flags(incomplete).includes('transit-unknown'));
  assert.equal(zero.extras, 0);
  assert.equal(zero.transitDays, 0);
  assert.equal(zero.costTotal, 20);
  assert.equal(zero.deliveryStatus, 'within');
  assert.equal(result.cheapest.id, 'zero');
  assert.equal(result.fastest.id, 'zero');
  assert.ok(flags(result).includes('cost-subset'));
  assert.ok(flags(result).includes('time-subset'));
});

test('reports invalid numbers with fields and does not convert them to zero', () => {
  const result = compare([{
    ...sample, freight: '-1', extras: '1,0', transitDays: 'soon', handoffs: '0.5',
  }], { deliveryLimitDays: '-2' });
  const [option] = result.options;

  assert.deepEqual(errorFields(result), ['deliveryLimitDays']);
  assert.deepEqual(errorFields(option), ['freight', 'extras', 'transitDays', 'handoffs']);
  assert.equal(option.costTotal, null);
  assert.equal(option.knownCost, null);
  assert.equal(option.transitDays, null);
  assert.equal(result.cheapest, null);
  assert.equal(result.fastest, null);
});

test('withholds rankings when active quote scopes differ or are unknown', () => {
  for (const scope of ['terminal-to-terminal', 'unknown', 'bogus']) {
    const result = compare([sample, { ...sample, id: 'other', scope }], { deliveryLimitDays: 21 });
    assert.equal(result.cheapest, null);
    assert.equal(result.cheapestWithinLimit, null);
    assert.equal(result.fastest, null);
    assert.ok(flags(result).includes('scope-mismatch'));
    assert.equal(result.options[0].convertedTotal, 300);
  }
});

test('never ranks expired, impossible or date-unverified quotes', () => {
  const result = compare([
    { ...sample, expires: today },
    { ...sample, id: 'expired', expires: '2026-11-18', scope: 'terminal-to-terminal', transitDays: 1, freight: 1 },
    { ...sample, id: 'undated', expires: '', transitDays: 2, freight: 2 },
    { ...sample, id: 'bad-date', expires: '2026-02-30', transitDays: 0, freight: 0 },
  ]);
  const [current, expired, undated, badDate] = result.options;
  assert.equal(current.expiryStatus, 'valid');
  assert.equal(expired.expiryStatus, 'expired');
  assert.ok(flags(expired).includes('quote-expired'));
  assert.ok(flags(undated).includes('expiry-unknown'));
  assert.deepEqual(errorFields(badDate), ['expires']);
  assert.equal(result.cheapest.id, 'undated');
  assert.equal(result.fastest.id, 'undated');

  const noDate = compare([{ ...sample, expires: today }], { today: '' });
  assert.ok(flags(noDate.options[0]).includes('expiry-unverified'));
  assert.equal(noDate.cheapest, null);
  assert.equal(noDate.fastest, null);
});

test('does not assume exchange rates when reference data is unavailable', () => {
  const quotes = [
    sample,
    { ...sample, id: 'foreign', mode: 'air', currency: 'EUR', freight: 1, extras: 0, transitDays: 1 },
  ];
  for (const fxInput of [
    undefined,
    { base: 'AUD', rates: { EUR: 1 }, dates: fx.dates },
    { base: 'USD', rates: { EUR: 1 }, dates: { EUR: '' } },
    { base: 'USD', rates: { EUR: 0 }, dates: fx.dates },
  ]) {
    const result = compare(quotes, { fx: fxInput });
    assert.equal(result.options[1].costTotal, 1);
    assert.equal(result.options[1].convertedTotal, null);
    assert.equal(result.options[1].fxDate, null);
    assert.ok(flags(result.options[1]).includes('fx-missing'));
    assert.equal(result.cheapest.id, 'sea');
    assert.equal(result.fastest.id, 'foreign');
  }
});

test('withholds cost rankings for conversions dated on different days', () => {
  const result = compare([
    sample,
    { ...sample, currency: 'EUR', id: 'euro' },
    { ...sample, currency: 'JPY', id: 'yen' },
  ], { fx: { ...fx, dates: { ...fx.dates, JPY: '2026-11-17' } } });
  assert.ok(flags(result).includes('fx-date-mismatch'));
  assert.equal(result.cheapest, null);
  assert.equal(result.cheapestWithinLimit, null);
  assert.ok(result.fastest);
  assert.equal(result.options[2].fxDate, '2026-11-17');
});

test('risk reminders come from known details and expose missing route, handoff and backup evidence', () => {
  const result = compare([
    { ...sample, mode: 'multimodal', handoffs: '', backup: false },
  ], { shipment: { destination: '大阪', product: '冷冻品' } });
  assert.ok(flags(result).includes('lane-missing'));
  assert.ok(flags(result).includes('load-missing'));
  assert.ok(flags(result).includes('goods-conditions'));
  assert.ok(flags(result.options[0]).includes('mode-check'));
  assert.ok(flags(result.options[0]).includes('handoffs'));
  assert.ok(flags(result.options[0]).includes('backup-unknown'));
  assert.ok(flags(compare([sample])).includes('lane-verify'));
});

test('ECB query sends only distinct supported currency codes and keeps the dates', async () => {
  const calls = [];
  const signal = new AbortController().signal;
  const result = await fetchFxRates(' usd ', ['JPY', 'usd', 'EUR', 'jpy', 'XXX', '货物资料'], {
    signal,
    fetchImpl: async (...args) => {
      calls.push(args);
      return {
        ok: true,
        json: async () => [
          { base: 'USD', quote: 'JPY', rate: 150, date: '2026-11-18' },
          { base: 'USD', quote: 'JPY', rate: 160, date: '2026-11-17' },
          { base: 'USD', quote: 'EUR', rate: 0.8, date: '2026-11-18' },
          { base: 'USD', quote: 'EUR', rate: -1, date: '2026-11-19' },
          { base: 'CNY', quote: 'JPY', rate: 40, date: '2026-11-19' },
          { base: 'USD', quote: 'RUB', rate: 95, date: '2026-11-19' },
        ],
      };
    },
  });
  assert.ok(FX_CURRENCIES.includes('CNY'));
  assert.ok(!FX_CURRENCIES.includes('RUB'));
  assert.equal(calls.length, 1);
  const [[address, request]] = calls;
  const url = new URL(address);
  assert.equal(url.origin + url.pathname, FX_SOURCE.endpoint);
  assert.deepEqual([...url.searchParams], [['base', 'USD'], ['quotes', 'JPY,EUR']]);
  assert.deepEqual(request, { signal, credentials: 'omit', referrerPolicy: 'no-referrer' });
  assert.deepEqual(result, { ...fx, source: FX_SOURCE });
});

test('same-currency comparisons need no request and FX failures do not produce rates', async () => {
  const unexpected = () => assert.fail('no FX request expected');
  assert.deepEqual(
    await fetchFxRates('CNY', ['CNY', 'XXX'], { fetchImpl: unexpected }),
    { base: 'CNY', rates: {}, dates: {}, source: FX_SOURCE },
  );
  await assert.rejects(fetchFxRates('USD', ['EUR'], {
    fetchImpl: async () => ({ ok: false, status: 503 }),
  }), /503/);
  await assert.rejects(fetchFxRates('USD', ['EUR'], {
    fetchImpl: async () => ({ ok: true, json: async () => ({ EUR: 0.8 }) }),
  }), /无效数据/);
  await assert.rejects(fetchFxRates('XXX', ['EUR'], { fetchImpl: unexpected }), /不支持/);
});
