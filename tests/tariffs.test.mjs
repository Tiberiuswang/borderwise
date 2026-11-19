import test from 'node:test';
import assert from 'node:assert/strict';
import { lookupTariff } from '../docs/tariffs.js';

const usSchedule = [
  { htsno: '6109.10.00', description: 'Of cotton', general: '16.5%', special: 'Free (AU, BH)', other: '90%' },
  { htsno: '', description: "Men's or boys':" },
  { htsno: '6109.10.00.04', description: 'T-shirts, all white', footnotes: [{}] },
  { htsno: '6109.90.10.00', description: 'Other textile materials', general: '18%' },
];

function jsonApiItem(type, id, attributes, links = {}) {
  return {
    type, id, attributes,
    relationships: Object.fromEntries(Object.entries(links).map(([name, data]) => [name, { data }])),
  };
}

const ref = (type, id) => ({ type, id });
function ukCommodity(measures) {
  const items = measures.map(([typeId, areaId, rate], index) => [
    jsonApiItem('measure', String(index), {}, {
      measure_type: ref('measure_type', typeId),
      geographical_area: ref('geographical_area', areaId),
      duty_expression: ref('duty_expression', String(index)),
    }),
    jsonApiItem('duty_expression', String(index), { base: rate }),
  ]);
  const data = jsonApiItem('commodity', '1', {
    goods_nomenclature_item_id: '6109100010', declarable: true, description_plain: 'T-shirts',
  }, { import_measures: items.map(([measure]) => ref(measure.type, measure.id)) });
  return { data, included: items.flat() };
}

test('invalid codes and unsupported destinations do not request external data', async () => {
  const fetchImpl = () => assert.fail('fetch should not be called');
  for (const code of ['', 'US 6109.10', '6109.10.000', '6109.10/?']) {
    const result = await lookupTariff({ destination: 'US', code }, { fetchImpl });
    assert.equal(result.status, 'invalid');
    assert.equal(result.sourceUrl, 'https://hts.usitc.gov/');
  }
  for (const destination of ['德国', '北爱尔兰', 'United States / Canada']) {
    const result = await lookupTariff({ destination, code: '6109100010' }, { fetchImpl });
    assert.equal(result.status, 'unsupported');
    assert.deepEqual(result.rows, []);
  }
});

test('US six digits show only matching legal tariff lines as candidates', async () => {
  const result = await lookupTariff({ destination: '美国', code: '6109.10' }, {
    fetchImpl: (url, options) => {
      assert.equal(url, '/api/tariffs/us?code=610910');
      assert.equal(options.credentials, 'omit');
      return Response.json(usSchedule);
    },
  });
  assert.equal(result.status, 'candidates');
  assert.equal(result.code, '610910');
  assert.equal(result.country, 'US');
  assert.equal(result.sourceUrl, 'https://hts.usitc.gov/search?query=610910');
  assert.ok(Number.isFinite(Date.parse(result.fetchedAt)));
  assert.equal(result.totalRows, 1);
  assert.deepEqual(result.rows.map(row => row.code), ['6109.10.00']);
  assert.equal(result.rows[0].general, '16.5%');
});

test('US exact statistical code uses the verified legal parent and does not substitute for an absent exact code', async () => {
  const fetchImpl = () => Response.json(usSchedule);
  const result = await lookupTariff({ destination: 'USA', code: '6109.10.00.04' }, { fetchImpl });
  assert.equal(result.status, 'found');
  assert.deepEqual(result.rows, [{
    code: '6109.10.00.04', description: 'T-shirts, all white', general: '16.5%',
    special: 'Free (AU, BH)', other: '90%', rateCode: '6109.10.00', hasNotes: true,
  }]);
  const missing = await lookupTariff({ destination: 'US', code: '6109100022' }, { fetchImpl });
  assert.equal(missing.status, 'not-found');
  assert.deepEqual(missing.rows, []);

  const noParent = await lookupTariff({ destination: 'US', code: '6109100004' }, {
    fetchImpl: () => Response.json(usSchedule.slice(1)),
  });
  assert.equal(noParent.status, 'found');
  assert.equal(noParent.rows[0].general, '');
});

test('US exact eight-digit legal line can be represented by a default statistical suffix', async () => {
  const result = await lookupTariff({ destination: 'US', code: '61099010' }, {
    fetchImpl: () => Response.json(usSchedule),
  });
  assert.equal(result.status, 'found');
  assert.equal(result.rows[0].code, '6109.90.10.00');
  assert.equal(result.rows[0].general, '18%');
});

test('UK exact declarable code returns only the worldwide third-country duty baseline', async () => {
  const result = await lookupTariff({ destination: 'UK', code: '6109100010' }, {
    fetchImpl: url => {
      assert.equal(url, 'https://www.trade-tariff.service.gov.uk/api/v2/commodities/6109100010');
      return Response.json(ukCommodity([['142', '1013', '0.00 %'], ['103', '1080', '0.00 %'], ['103', '1011', '12.00 %']]));
    },
  });
  assert.equal(result.status, 'found');
  assert.equal(result.country, 'GB');
  assert.equal(result.sourceUrl, 'https://www.trade-tariff.service.gov.uk/commodities/6109100010');
  assert.deepEqual(result.rows, [{
    code: '6109100010', description: 'T-shirts', general: '12.00 %', special: '', other: '',
    rateCode: '6109100010', hasNotes: false,
  }]);

  for (const measures of [[['142', '1013', '0.00 %']], [['103', '1011', '2%'], ['103', '1011', '10%']]]) {
    const unresolved = await lookupTariff({ destination: 'GB', code: '6109100010' }, {
      fetchImpl: () => Response.json(ukCommodity(measures)),
    });
    assert.equal(unresolved.status, 'found');
    assert.equal(unresolved.rows[0].general, '');
  }
});

test('UK prefix only offers matching declarable codes without assuming their duty', async () => {
  const commodities = [
    jsonApiItem('commodity', '1', { goods_nomenclature_item_id: '6109100000', description_plain: 'Of cotton', declarable: false }),
    jsonApiItem('commodity', '2', { goods_nomenclature_item_id: '6109100010', description_plain: 'T-shirts', declarable: true }),
    jsonApiItem('commodity', '3', { goods_nomenclature_item_id: '6109902000', description_plain: 'Of wool', declarable: true }),
  ];
  const result = await lookupTariff({ destination: '英国', code: '6109.10.00' }, {
    fetchImpl: url => {
      assert.equal(url, 'https://www.trade-tariff.service.gov.uk/api/v2/headings/6109');
      const data = jsonApiItem('heading', '6109', {}, { commodities: commodities.map(item => ref(item.type, item.id)) });
      return Response.json({ data, included: commodities });
    },
  });
  assert.equal(result.status, 'candidates');
  assert.equal(result.sourceUrl, 'https://www.trade-tariff.service.gov.uk/headings/6109');
  assert.deepEqual(result.rows.map(row => [row.code, row.general]), [['6109100010', '']]);
});

test('unavailable services and malformed responses are separate from official no results', async () => {
  const request = { destination: 'US', code: '610910' };
  for (const fetchImpl of [
    async () => { throw new TypeError('Network error'); },
    () => new Response('Missing Pages Function', { status: 404 }),
    () => Response.json({ data: [] }),
  ]) {
    const result = await lookupTariff(request, { fetchImpl });
    assert.equal(result.status, 'unavailable');
    assert.equal(result.fetchedAt, null);
    assert.equal(result.sourceUrl, 'https://hts.usitc.gov/search?query=610910');
  }
  const empty = await lookupTariff(request, { fetchImpl: () => Response.json([]) });
  assert.equal(empty.status, 'not-found');
  const absent = await lookupTariff({ destination: 'GB', code: '9999999999' }, {
    fetchImpl: () => Response.json({ errors: [{ detail: 'not found' }] }, { status: 404 }),
  });
  assert.equal(absent.status, 'not-found');
});
