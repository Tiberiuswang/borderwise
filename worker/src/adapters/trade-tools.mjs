import { analyzeShipment, SOURCES } from '../../../docs/engine.js';
import { lookupTariff } from '../../../docs/tariffs.js';

const USITC = 'https://hts.usitc.gov';
const HMRC = 'https://www.trade-tariff.service.gov.uk';
const CODE_PATTERN = '^(?:[0-9]{6}|[0-9]{8}|[0-9]{10})$';
const CODE = new RegExp(CODE_PATTERN);
const MAX_CHECKS = 8;
const MAX_AGENT_TARIFF_ROWS = 6;
const MAX_TARIFF_BYTES = 4 * 1024 * 1024;

const REFERENCES = new Map(SOURCES.map(({ id, title, url }) => [id, { title, url }]));
for (const [id, title, url] of [
  ['us-tariff', '美国国际贸易委员会 USITC 税则', USITC + '/'],
  ['gb-tariff', '英国 HMRC Online Trade Tariff', HMRC + '/'],
  ['cbp', '美国海关与边境保护局 CBP 进口指南', 'https://www.cbp.gov/trade/basic-import-export/importing-into-the-united-states'],
  ['uk-import', '英国政府进口流程', 'https://www.gov.uk/import-goods-into-uk'],
  ['ofac', '美国财政部 OFAC 制裁名单服务', 'https://sanctionslist.ofac.treas.gov/'],
  ['uk-sanctions', '英国政府制裁名单', 'https://www.gov.uk/government/publications/the-uk-sanctions-list'],
  ['imo', '国际海事组织 IMO 危险货物海运资料', 'https://www.imo.org/en/OurWork/Safety/Pages/DangerousGoods-default.aspx'],
]) {
  REFERENCES.set(id, { title, url });
}

const SOURCE_TOPICS = Object.freeze({
  tariffs: ['us-tariff', 'gb-tariff'],
  classification: ['wco', 'us-tariff', 'gb-tariff'],
  origin: ['origin', 'rcep'],
  sanctions: ['sanctions', 'ofac', 'uk-sanctions'],
  cbam: ['cbam'],
  rcep: ['rcep'],
  customs: ['customs', 'cbp', 'uk-import', 'export'],
  transport: ['incoterms', 'imo'],
});

const MARKETS = {
  US: {
    names: 'united states(?: of america)?|u\\.?s\\.?a?\\.?|美国|美利坚合众国',
    exact: /^(?:us|usa|u\.s\.?|u\.s\.a\.?|united states(?: of america)?|美国|美利坚合众国)$/i,
  },
  GB: {
    names: 'united kingdom|great britain|u\\.?k\\.?|gbr?|england|scotland|wales|英国|大不列颠|英格兰|苏格兰|威尔士',
    exact: /^(?:gb|gbr|uk|u\.k\.?|united kingdom|great britain|england|scotland|wales|英国|大不列颠|英格兰|苏格兰|威尔士)$/i,
  },
};
const HS_LABEL = /(?:\b(?:hs|hts)(?:\s*(?:codes?|numbers?|no\.?|编码|税号))?\b|(?:hs|hts)\s*(?:编码|税号)|商品编码|海关编码|税则号列|关税编码|税号|\btariff\s+(?:code|number)\b)\s*[:：=为是#]?\s*([0-9]+(?:[.-][0-9]+)*)(?![\p{N}A-Za-z]|[.-][0-9])/giu;
const SPECIFIC_DESTINATION = /目的(?:地|国)\s*(?:为|是|在|[:：])|出口到|出口至|运往|发往|\bdestinations?(?:\s+country)?\s*(?:is\b|[:=])|\b(?:import(?:s|ing)?\s+into|(?:export|ship)(?:s|ing)?\s+to)\b/i;
const PRIORITY = { high: 0, medium: 1, info: 2 };
const REVIEW_SCOPE = '根据所填表单运行本地规则，输出待核验事项，未验证申报信息、适用法规或交易方名单。';
const TARIFF_SCOPE = '仅供参考的目的地分类和基础税则。实际税负还取决于归类、原产地、优惠资格、附加税和其他适用措施。';

function parameters(properties = {}, required = []) {
  return { type: 'object', properties, required, additionalProperties: false };
}

function referenceSources(ids) {
  return [...new Set(ids)].filter(id => REFERENCES.has(id))
    .map(id => ({ ...REFERENCES.get(id), kind: 'reference' }));
}

function checkShipment(_args, { shipment } = {}) {
  const { input, checks } = analyzeShipment(shipment);
  const ranked = checks.filter(check => check.id !== 'limitations')
    .sort((left, right) => PRIORITY[left.level] - PRIORITY[right.level]);
  const top = ranked.slice(0, MAX_CHECKS);

  return {
    status: Object.values(input).some(Boolean) ? 'ok' : 'needs_input',
    data: {
      scope: REVIEW_SCOPE,
      totalChecks: ranked.length,
      checks: top.map(({ id, level, title, detail, action }) => ({ id, level, title, detail, action })),
    },
    sources: referenceSources(top.map(check => check.sourceId)),
  };
}

function validLookup({ destination, code } = {}) {
  return (destination === 'US' || destination === 'GB') && typeof code === 'string' && code.trim() === code && CODE.test(code);
}

function normalizedSuppliedCode(value) {
  const text = typeof value === 'string' || Number.isSafeInteger(value) ? String(value).trim() : '';
  if (!/^[0-9]+(?:[. -][0-9]+)*$/.test(text)) return '';
  const digits = text.replace(/[. -]/g, '');
  return digits.length >= 6 && digits.length <= 12 ? digits : '';
}

function questionNamesMarket(question, { names }) {
  const market = '(?<![A-Za-z])(?:' + names + ')(?![A-Za-z])';
  const directional = '(?:目的(?:国|地)(?:为|是|在|\\s*[:：])?|进口到|出口到|出口至|发往|运往|进入|到|\\bdestinations?(?: country)?(?:(?:\\s+is\\b)?\\s*[:=]\\s*|\\s+(?:is\\s+)?)|\\b(?:into|to)\\s+)';
  const duty = '(?:的?\\s*(?:适用)?\\s*(?:进口税率|进口税|关税税率|关税|税率|\\b(?:import\\s+)?(?:tariffs?|dut(?:y|ies)|hts)\\b))';
  const routeMention = directional + '\\s*(?:the\\s+)?' + market;
  const dutyMention = market + '(?:\\s*(?:' + HS_LABEL.source + '))?' + duty;
  const matches = question.matchAll(new RegExp(routeMention + '|' + dutyMention, 'giu'));
  for (const match of matches) {
    const before = question.slice(Math.max(0, match.index - 12), match.index);
    const after = question.slice(match.index + match[0].length);
    if (/(?:不(?:是|要|能|到|在)?|未|非|排除|除开|\bnot|\bexcept|\bexcluding)\s*$/i.test(before)) continue;
    if (/^(?:以外|之外|除外)/.test(after.trimStart())) continue;
    return true;
  }
  return false;
}

function reviewLookup(args, { question = '', shipment = {} } = {}) {
  if (!validLookup(args)) return false;
  const text = typeof question === 'string' ? question : '';
  const mentionedCodes = [...text.matchAll(HS_LABEL)].map(match => normalizedSuppliedCode(match[1]));
  const caseCode = normalizedSuppliedCode(shipment?.hs);
  const codes = mentionedCodes.length ? mentionedCodes : [caseCode];
  const requestedMarkets = Object.entries(MARKETS)
    .filter(([, market]) => questionNamesMarket(text, market))
    .map(([destination]) => destination);
  const caseDestination = typeof shipment?.destination === 'string' ? shipment.destination.trim() : '';
  const destinationMatches = requestedMarkets.length
    ? requestedMarkets.includes(args.destination)
    : !SPECIFIC_DESTINATION.test(text) && MARKETS[args.destination].exact.test(caseDestination);
  return destinationMatches && codes.some(code => code.startsWith(args.code));
}

function validatedOrigin(origin) {
  if (typeof origin !== 'string') return '';
  try {
    const url = new URL(origin);
    return url.protocol === 'https:' && url.origin === origin ? origin : '';
  } catch {
    return '';
  }
}

function boundedResponse(response) {
  if (!response.ok || !response.body) return response;
  if (Number(response.headers.get('Content-Length')) > MAX_TARIFF_BYTES) {
    void response.body.cancel().catch(() => {});
    throw new Error('Tariff response exceeds the size limit');
  }

  let size = 0;
  const stream = response.body.pipeThrough(new TransformStream({
    transform(chunk, controller) {
      size += chunk.byteLength;
      if (size > MAX_TARIFF_BYTES) {
        controller.error(new Error('Tariff response exceeds the size limit'));
        return;
      }
      controller.enqueue(chunk);
    },
  }));
  return new Response(stream, { status: response.status, headers: response.headers });
}

function tariffFetcher({ country, code, origin, fetchImpl }) {
  const path = '/api/tariffs/us?code=' + code;
  const resource = code.length === 10 ? 'commodities/' + code : 'headings/' + code.slice(0, 4);
  const gbUrl = HMRC + '/api/v2/' + resource;

  return async (url, { signal } = {}) => {
    if (country === 'US' ? url !== path || !origin : url !== gbUrl) {
      throw new Error('Tariff endpoint is unavailable');
    }
    const response = await fetchImpl(country === 'US' ? origin + path : gbUrl, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      credentials: 'omit',
      redirect: 'manual',
      signal,
    });
    if (!response.ok) {
      void response.body?.cancel().catch(() => {});
      return new Response(null, { status: response.status });
    }
    return boundedResponse(response);
  };
}

function boundedText(value, maxLength) {
  return typeof value === 'string' ? value.slice(0, maxLength) : '';
}

function compactRow({ code, description, general, special, other, rateCode, hasNotes }) {
  return {
    code: boundedText(code, 16),
    description: boundedText(description, 240),
    general: boundedText(general, 96),
    special: boundedText(special, 96),
    other: boundedText(other, 96),
    rateCode: boundedText(rateCode, 16),
    hasNotes,
  };
}

async function checkTariff(args, { origin, fetchImpl }, signal) {
  if (!validLookup(args)) {
    return {
      status: 'needs_input',
      data: { note: '请提供美国或英国作为目的地，以及 6、8 或 10 位商品编码。' },
      sources: [],
    };
  }

  const { destination, code } = args;
  const result = await lookupTariff(args, {
    fetchImpl: tariffFetcher({ country: destination, code, origin, fetchImpl }),
    signal,
  });
  const observed = result.status === 'found' || result.status === 'candidates';
  const source = { title: result.sourceName, url: result.sourceUrl, kind: observed ? 'lookup' : 'reference' };
  if (observed) source.retrievedAt = result.fetchedAt;

  return {
    status: observed ? 'ok' : result.status === 'unavailable' ? 'unavailable' : 'needs_input',
    data: {
      country: result.country,
      code: result.code,
      match: result.status,
      scope: TARIFF_SCOPE,
      ...(result.edition && { edition: boundedText(result.edition, 80) }),
      rows: result.rows.slice(0, MAX_AGENT_TARIFF_ROWS).map(compactRow),
      totalRows: result.totalRows,
      ...(result.status === 'candidates' && { note: '查询返回候选税目，需确认申报用的完整商品编码。' }),
    },
    sources: [source],
  };
}

function officialSources({ topic } = {}) {
  if (!Object.hasOwn(SOURCE_TOPICS, topic)) {
    return { status: 'needs_input', data: { note: '请指定要查询的官方资料主题。' }, sources: [] };
  }

  return {
    status: 'ok',
    data: { topic, note: '以下链接为官方查询入口，尚未核验其内容或对该批货物的适用性。' },
    sources: referenceSources(SOURCE_TOPICS[topic]),
  };
}

export function createTradeTools({ origin, fetchImpl = globalThis.fetch } = {}) {
  const tariffConfig = { origin: validatedOrigin(origin), fetchImpl };
  return [
    {
      name: 'review_shipment',
      description: '按已提供的运输表单运行本地规则，列出资料缺口、高风险提示和待核验动作。',
      parameters: parameters(),
      execute: checkShipment,
    },
    {
      name: 'lookup_tariff',
      description: '按用户提供的目的地和 HS 编码联网查询美国或英国官方基础税则，返回匹配的税目或候选项。',
      parameters: parameters({
        destination: { type: 'string', enum: ['US', 'GB'] },
        code: { type: 'string', pattern: CODE_PATTERN },
      }, ['destination', 'code']),
      review: reviewLookup,
      execute: (args, _context, signal) => checkTariff(args, tariffConfig, signal),
    },
    {
      name: 'official_sources',
      description: '按主题列出官方资料查询入口。支持关税 tariffs、商品归类 classification、原产地 origin、制裁 sanctions、CBAM cbam、RCEP rcep、海关 customs、运输 transport。',
      parameters: parameters({
        topic: { type: 'string', enum: Object.keys(SOURCE_TOPICS) },
      }, ['topic']),
      execute: officialSources,
    },
  ];
}
