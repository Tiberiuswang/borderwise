const USITC = 'https://hts.usitc.gov';
const HMRC = 'https://www.trade-tariff.service.gov.uk';
const MAX_ROWS = 12;
const DESTINATIONS = new Map([
  ['us', 'US'], ['usa', 'US'], ['united states', 'US'], ['united states of america', 'US'], ['美国', 'US'], ['美利坚合众国', 'US'],
  ['gb', 'GB'], ['gbr', 'GB'], ['uk', 'GB'], ['united kingdom', 'GB'], ['great britain', 'GB'], ['英国', 'GB'], ['大不列颠', 'GB'],
  ['england', 'GB'], ['scotland', 'GB'], ['wales', 'GB'], ['英格兰', 'GB'], ['苏格兰', 'GB'], ['威尔士', 'GB'],
]);
const SOURCE_NAMES = { US: '美国国际贸易委员会 USITC', GB: '英国 HMRC Online Trade Tariff' };

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeCode(value) {
  const input = text(value);
  return /^\d+(?:[.\s-]\d+)*$/.test(input) ? input.replace(/[.\s-]/g, '') : '';
}

function officialUrl(country, code) {
  if (country === 'US') return code ? USITC + '/search?query=' + code : USITC + '/';
  if (country === 'GB') {
    if (code.length === 10) return HMRC + '/commodities/' + code;
    return code.length >= 6 ? HMRC + '/headings/' + code.slice(0, 4) : HMRC + '/';
  }
  return '';
}

function lookupUrl(country, code) {
  if (country === 'US') return '/api/tariffs/us?code=' + code;
  const resource = code.length === 10 ? 'commodities/' + code : 'headings/' + code.slice(0, 4);
  return HMRC + '/api/v2/' + resource;
}

function usRates(row) {
  return { general: text(row.general), special: text(row.special), other: text(row.other) };
}

function usResultRow(row, parent = row) {
  const directRates = usRates(row);
  const rateRow = Object.values(directRates).some(Boolean) ? row : parent;
  const rates = usRates(rateRow);
  return {
    code: row.htsno,
    description: text(row.description),
    ...rates,
    rateCode: Object.values(rates).some(Boolean) ? rateRow.htsno : '',
    hasNotes: Boolean(row.footnotes?.length || rateRow.footnotes?.length || row.additionalDuties || rateRow.additionalDuties),
  };
}

function usMatches(payload, code) {
  if (!Array.isArray(payload) || payload.some(row => typeof row?.htsno !== 'string')) {
    throw new Error('Unexpected USITC response');
  }
  const rows = new Map(payload.map(row => [normalizeCode(row.htsno), row]));
  if (code.length === 10) {
    const exact = rows.get(code);
    return exact ? [usResultRow(exact, rows.get(code.slice(0, 8)))] : [];
  }
  if (code.length === 8) {
    const exact = rows.get(code) || rows.get(code + '00');
    return exact ? [usResultRow(exact)] : [];
  }

  // USITC sometimes serializes an eight-digit tariff line with the default statistical suffix 00.
  const legalRows = new Map();
  for (const [number, row] of rows) {
    if (!number.startsWith(code)) continue;
    if (number.length === 8) {
      legalRows.set(number, row);
    } else if (number.length === 10 && number.endsWith('00') && !legalRows.has(number.slice(0, 8))) {
      legalRows.set(number.slice(0, 8), row);
    }
  }
  return [...legalRows.values()].map(row => usResultRow(row));
}

function reference(item, name) {
  return item.relationships?.[name]?.data;
}

function ukResultRow(item, general = '', hasNotes = false) {
  const { goods_nomenclature_item_id: code, description_plain, description } = item.attributes;
  return {
    code,
    description: text(description_plain) || text(description),
    general,
    special: '',
    other: '',
    rateCode: general ? code : '',
    hasNotes,
  };
}

function ukMatches(payload, code) {
  const exact = code.length === 10;
  const data = payload?.data;
  const links = data && reference(data, exact ? 'import_measures' : 'commodities');
  if (data?.type !== (exact ? 'commodity' : 'heading') || !Array.isArray(links) || !Array.isArray(payload.included)) {
    throw new Error('Unexpected HMRC response');
  }
  const included = new Map(payload.included.map(item => [item.type + ':' + item.id, item]));
  const follow = ref => ref && included.get(ref.type + ':' + ref.id);
  const items = links.map(follow).filter(Boolean);

  if (!exact) {
    return items.filter(item => item.type === 'commodity' &&
      item.attributes?.declarable && /^\d{10}$/.test(item.attributes.goods_nomenclature_item_id) &&
      item.attributes.goods_nomenclature_item_id.startsWith(code))
      .map(item => ukResultRow(item));
  }
  if (!data.attributes?.declarable || data.attributes.goods_nomenclature_item_id !== code) return [];

  // HMRC measure 103 is Third country duty. Area 1011 is ERGA OMNES (the worldwide baseline).
  const baseline = items.filter(item => item.type === 'measure' && reference(item, 'measure_type')?.id === '103' &&
    reference(item, 'geographical_area')?.id === '1011');
  const expressions = new Set(baseline.map(item => text(follow(reference(item, 'duty_expression'))?.attributes?.base)));
  const general = expressions.size === 1 ? [...expressions][0] : '';
  const hasNotes = Boolean(reference(data, 'footnotes')?.length || baseline.some(item =>
    reference(item, 'footnotes')?.length || reference(item, 'excluded_countries')?.length ||
    reference(item, 'measure_conditions')?.length));
  return [ukResultRow(data, general, hasNotes)];
}

export async function lookupTariff({ destination, code: input } = {}, { fetchImpl = fetch, signal } = {}) {
  const country = DESTINATIONS.get(text(destination).toLowerCase()) || '';
  const code = normalizeCode(input);
  const valid = [6, 8, 10].includes(code.length);
  const result = {
    country,
    code,
    sourceName: SOURCE_NAMES[country] || '',
    sourceUrl: officialUrl(country, valid ? code : ''),
    fetchedAt: null,
    rows: [],
    totalRows: 0,
  };
  if (!country) return { ...result, status: 'unsupported' };
  if (!valid) return { ...result, status: 'invalid' };

  try {
    const timeout = AbortSignal.timeout(10_000);
    const response = await fetchImpl(lookupUrl(country, code), {
      credentials: 'omit',
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
    const fetchedAt = new Date().toISOString();
    if (country === 'GB' && response.status === 404) return { ...result, fetchedAt, status: 'not-found' };
    if (!response.ok) return { ...result, status: 'unavailable' };

    const payload = await response.json();
    const candidates = country === 'US' ? code.length === 6 : code.length !== 10;
    const matches = country === 'US' ? usMatches(payload, code) : ukMatches(payload, code);
    const status = !matches.length ? 'not-found' : candidates ? 'candidates' : 'found';
    return { ...result, fetchedAt, rows: matches.slice(0, MAX_ROWS), totalRows: matches.length, status };
  } catch {
    return { ...result, status: 'unavailable' };
  }
}
