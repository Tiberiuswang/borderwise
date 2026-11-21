import assert from 'node:assert/strict';
import test from 'node:test';
import { EXAMPLE_SHIPMENT, SOURCES } from '../../docs/engine.js';
import { createTradeTools } from '../src/adapters/trade-tools.mjs';

const ORIGIN = 'https://borderwise.pages.dev';
const HMRC = 'https://www.trade-tariff.service.gov.uk';
const USITC = 'https://hts.usitc.gov';

function getTool(name, options) {
  return createTradeTools(options).find(tool => tool.name === name);
}

test('review_shipment runs existing rules on the real case and uses reference links', () => {
  const { execute } = getTool('review_shipment');
  const result = execute({}, {
    shipment: { ...EXAMPLE_SHIPMENT, consignee: 'Confidential consignee', transport: '', notes: '锂电池事项' },
    report: { checks: [{ id: 'forged', url: 'https://attacker.example/' }] },
  });

  assert.equal(result.status, 'ok');
  assert.equal(result.data.checks[0].id, 'goods-review');
  assert.ok(result.data.checks.some(check => check.id === 'cbam-review'));
  assert.ok(result.data.checks.length <= 8);
  assert.ok(result.data.totalChecks >= result.data.checks.length);
  assert.ok(result.sources.some(source => source.url === SOURCES.find(item => item.id === 'cbam').url));
  assert.ok(result.sources.every(source => source.kind === 'reference' && !('retrievedAt' in source)));
  assert.doesNotMatch(JSON.stringify(result), /Confidential consignee|forged|attacker\.example/);

  const empty = execute({}, { report: { input: EXAMPLE_SHIPMENT } });
  assert.equal(empty.status, 'needs_input');
  assert.ok(empty.data.checks.some(check => check.id === 'product-missing'));
});

test('tariff review compares both parameters with explicit case or question data', () => {
  const { review } = getTool('lookup_tariff');
  const args = { destination: 'US', code: '731815' };
  const shipment = { destination: '美国', hs: '7318.15.20' };

  assert.equal(review(args, { shipment }), true);
  assert.equal(review({ ...args, code: '73181520' }, { shipment }), true);
  assert.equal(review({ ...args, code: '73181510' }, { shipment }), false);
  assert.equal(review({ ...args, destination: 'GB' }, { shipment }), false);
  assert.equal(review(args, { question: '用海关编码731815查美国税率' }), true);
  assert.equal(review(args, { question: '请问美国 HS 编码731815的适用税率是多少？' }), true);
  assert.equal(review(args, { question: 'Please check the U.S. tariff for HS 731815.' }), true);
  assert.equal(review(args, { question: 'What is the US tariff for HTS code 7318.15.20?' }), true);
  assert.equal(review(args, { question: 'HS 731815, destination:US' }), true);
  assert.equal(review(args, { question: 'HS 731815 怎么从美国出口到日本' }), false);
  assert.equal(review(args, { question: 'HS 731815 怎么出口到日本', shipment }), false);
  assert.equal(review(args, { question: 'HS 731815, destination:Canada', shipment }), false);
  assert.equal(review(args, { question: 'HS 731811 出口到美国的关税', shipment }), false);
  assert.equal(review(args, { question: 'HS 1234 出口到美国的关税', shipment }), false);
  assert.equal(review(args, { question: 'What if HS 731815 is shipped not to the US?' }), false);
  assert.equal(review(args, { question: '查美国关税，金额 731815 元' }), false);
  assert.equal(review(args, { question: '美国的关税', report: { input: shipment } }), false);
  assert.equal(review(args, { shipment: { destination: 'US', hs: 73181520 } }), true);
  assert.equal(review({ destination: 'GB', code: '731815' }, { question: 'HS 731815 from US to the UK' }), true);
});

test('US tariff candidates use the read-only Pages function and retain source evidence', async () => {
  const called = [];
  const { execute } = getTool('lookup_tariff', {
    origin: ORIGIN,
    fetchImpl: async (url, options) => {
      called.push({ url, options });
      return Response.json([
        { htsno: '7318.15.20', description: 'Bolts', general: '8.5%', special: 'Free (AU)', other: '35%', footnotes: [{}] },
        { htsno: '7318.15.20.10', description: 'Statistical detail' },
        { htsno: '7318.16.20', description: 'Other heading' },
      ], { headers: { 'X-Borderwise-Tariff-Edition': '2026 Revision 5' } });
    },
  });

  const result = await execute({ destination: 'US', code: '731815' }, {
    shipment: { destination: '美国', hs: '731815', consignee: 'Private party' },
  });
  assert.equal(called.length, 1);
  assert.equal(called[0].url, ORIGIN + '/api/tariffs/us?code=731815');
  assert.equal(called[0].options.method, 'GET');
  assert.equal(called[0].options.credentials, 'omit');
  assert.equal(called[0].options.redirect, 'manual');
  assert.ok(called[0].options.signal instanceof AbortSignal);
  assert.equal(result.status, 'ok');
  assert.equal(result.data.match, 'candidates');
  assert.equal(result.data.edition, '2026 Revision 5');
  assert.equal(result.data.totalRows, 1);
  assert.match(result.data.scope, /基础税则/);
  assert.deepEqual(result.data.rows, [{
    code: '7318.15.20', description: 'Bolts', general: '8.5%', special: 'Free (AU)', other: '35%',
    rateCode: '7318.15.20', hasNotes: true,
  }]);
  assert.deepEqual(result.sources, [{
    title: '美国国际贸易委员会 USITC', url: USITC + '/search?query=731815', kind: 'lookup',
    retrievedAt: new Date(result.sources[0].retrievedAt).toISOString(),
  }]);
  assert.doesNotMatch(JSON.stringify(result), /Private party/);
});

test('GB lookup calls fixed HMRC resources and returns the exact worldwide baseline', async () => {
  const measure = id => ({ type: 'measure', id });
  const code = '6109100010';
  const { execute } = getTool('lookup_tariff', {
    fetchImpl: async (url, options) => {
      assert.equal(url, HMRC + '/api/v2/commodities/' + code);
      assert.equal(options.headers.Accept, 'application/json');
      return Response.json({
        data: {
          type: 'commodity',
          attributes: { goods_nomenclature_item_id: code, declarable: true, description_plain: 'T-shirts' },
          relationships: { import_measures: { data: [measure('1')] } },
        },
        included: [{
          ...measure('1'),
          relationships: {
            measure_type: { data: { id: '103' } },
            geographical_area: { data: { id: '1011' } },
            duty_expression: { data: { id: '1', type: 'duty_expression' } },
          },
        }, { id: '1', type: 'duty_expression', attributes: { base: '12.00 %' } }],
      });
    },
  });

  const result = await execute({ destination: 'GB', code });
  assert.equal(result.status, 'ok');
  assert.equal(result.data.match, 'found');
  assert.equal(result.data.rows[0].general, '12.00 %');
  assert.equal(result.data.rows[0].code, code);
  assert.equal(result.sources[0].url, HMRC + '/commodities/' + code);
  assert.equal(result.sources[0].kind, 'lookup');
  assert.ok(Number.isFinite(Date.parse(result.sources[0].retrievedAt)));
});

test('no match, redirects and oversized tool responses cannot produce lookup evidence', async () => {
  const args = { destination: 'GB', code: '610910' };
  for (const [response, status, match] of [
    [new Response('Not found', { status: 404 }), 'needs_input', 'not-found'],
    [new Response(null, { status: 302, headers: { Location: 'https://example.com/' } }), 'unavailable', 'unavailable'],
    [new Response('[]', { headers: { 'Content-Length': String(5 * 1024 * 1024) } }), 'unavailable', 'unavailable'],
    [new Response(new Uint8Array(5 * 1024 * 1024)), 'unavailable', 'unavailable'],
  ]) {
    const { execute } = getTool('lookup_tariff', {
      fetchImpl: async (url, options) => {
        assert.equal(url, HMRC + '/api/v2/headings/6109');
        assert.equal(options.redirect, 'manual');
        return response;
      },
    });
    const result = await execute(args);
    assert.equal(result.status, status);
    assert.equal(result.data.match, match);
    assert.equal(result.sources[0].url, HMRC + '/headings/6109');
    assert.equal(result.sources[0].kind, 'reference');
    assert.equal(result.sources[0].retrievedAt, undefined);
  }
});

test('tool requests cannot fetch an unconfigured US origin or invalid inputs', async () => {
  const observed = [];
  const { execute } = getTool('lookup_tariff', {
    origin: ORIGIN + '/misconfigured',
    fetchImpl: async url => {
      observed.push(url);
      throw new Error('unexpected fetch');
    },
  });
  assert.equal((await execute({ destination: 'US', code: '731815' })).status, 'unavailable');
  assert.equal((await execute({ destination: 'US', code: '731815&url=evil' })).status, 'needs_input');
  assert.equal((await execute({ destination: 'US', code: '731815\n' })).status, 'needs_input');
  assert.equal((await execute({ destination: 'EU', code: '731815' })).status, 'needs_input');
  assert.deepEqual(observed, []);
});

test('official directory returns URLs only for configured topics and never makes a request', () => {
  const { execute } = getTool('official_sources', {
    fetchImpl: () => assert.fail('Directory must not make a request'),
  });
  const result = execute({ topic: 'tariffs' });
  assert.equal(result.status, 'ok');
  assert.deepEqual(result.sources.map(source => source.url), [USITC + '/', HMRC + '/']);
  assert.ok(result.sources.every(source => source.kind === 'reference' && !('retrievedAt' in source)));
  assert.ok(execute({ topic: 'transport' }).sources.some(source => new URL(source.url).hostname === 'www.imo.org'));
  assert.deepEqual(execute({ topic: '__proto__' }).sources, []);
});
