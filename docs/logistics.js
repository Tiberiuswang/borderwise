export const LOGISTICS_MODES = Object.freeze({
  ocean: '海运',
  rail: '铁路',
  air: '空运',
  road: '公路',
  multimodal: '多式联运',
});

export const LOGISTICS_SCOPES = Object.freeze({
  'door-to-door': '门到门',
  'terminal-to-terminal': '场站到场站',
  'door-to-terminal': '门到场站',
  'terminal-to-door': '场站到门',
  unknown: '待确认',
});

export const LOGISTICS_FEE_CATEGORIES = Object.freeze({
  terminalHandling: '码头操作费（THC）',
  fuel: '燃油附加费',
  insurance: '运输保险',
  drayage: '提送货 / 短驳',
  clearance: '报关服务费',
  storage: '仓储费',
  demurrage: '滞港费',
  detention: '滞箱费',
  other: '其他附加费',
});

export const FX_SOURCE = Object.freeze({
  name: '欧洲中央银行（ECB）参考汇率，经 Frankfurter 提供',
  url: 'https://www.ecb.europa.eu/stats/policy_and_exchange_rates/euro_reference_exchange_rates/html/index.en.html',
  providerUrl: 'https://frankfurter.dev/providers/ecb/',
  endpoint: 'https://api.frankfurter.dev/v2/providers/ecb/rates',
});

export const FX_CURRENCIES = Object.freeze([
  'AUD', 'BRL', 'CAD', 'CHF', 'CNY', 'CZK', 'DKK', 'EUR', 'GBP', 'HKD',
  'HUF', 'IDR', 'ILS', 'INR', 'ISK', 'JPY', 'KRW', 'MXN', 'MYR', 'NOK',
  'NZD', 'PHP', 'PLN', 'RON', 'SEK', 'SGD', 'THB', 'TRY', 'USD', 'ZAR',
]);

const MODE_FLAGS = {
  ocean: '确认船期、截单截港时间、港口作业与滞箱滞港费用。',
  rail: '确认班列班次、场站接驳安排以及跨境时的换装条件。',
  air: '复核计费重量、安检要求、舱位和地面操作时长。',
  road: '确认车辆与司机安排、提送货时窗及跨境口岸等待是否计入时效。',
  multimodal: '确认各运输段的运力已衔接，以及全程运输单证与保险的覆盖范围。',
};

function scalar(value) {
  return typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
}

function currencyCode(value) {
  const code = scalar(value).toUpperCase();
  return /^[A-Z]{3}$/.test(code) ? code : '';
}

function readNumber(raw, { integer = false } = {}) {
  if (raw === undefined || raw === null || (typeof raw === 'string' && !raw.trim())) {
    return { value: null, invalid: false };
  }
  const text = scalar(raw);
  const numeric = /^(?:(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d*)?|\.\d+)$/.test(text);
  const value = typeof raw === 'number' || numeric ? Number(text.replaceAll(',', '')) : NaN;
  const valid = Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER &&
    (!integer || Number.isInteger(value));
  return { value: valid ? value : null, invalid: !valid };
}

function validDate(value) {
  const text = scalar(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const time = Date.parse(text);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === text;
}

export function localCalendarDate(date = new Date()) {
  return [date.getFullYear(), date.getMonth() + 1, date.getDate()]
    .map((part, index) => String(part).padStart(index ? 2 : 4, '0')).join('-');
}

function readQuoteExtras(quote) {
  const lump = readNumber(quote.extras);
  const fees = {};
  let invalid = quote.fees != null && (typeof quote.fees !== 'object' || Array.isArray(quote.fees));
  if (quote.fees && !invalid) {
    for (const [key, raw] of Object.entries(quote.fees)) {
      const amount = readNumber(raw);
      if (!Object.hasOwn(LOGISTICS_FEE_CATEGORIES, key) || amount.invalid) invalid = true;
      else if (amount.value !== null) fees[key] = amount.value;
    }
  }
  const complete = quote.feesComplete === true;
  const hasFees = Object.keys(fees).length > 0;
  if (!(hasFees || complete || invalid)) {
    return {
      total: lump.value, subtotal: lump.value ?? 0,
      error: lump.invalid ? {
        field: 'extras', message: '费用须为非负金额。金额未知时可留空，确认无额外费用时请填 0。',
      } : null,
    };
  }
  const subtotal = Object.values(fees).reduce((sum, amount) => sum + amount, 0);
  let error = null;
  if (lump.value !== null || lump.invalid) {
    error = { field: 'extras', message: '附加费合计与明细只能填一种，请清除重复项。' };
  } else if (invalid || subtotal > Number.MAX_SAFE_INTEGER) {
    error = { field: 'fees', message: '附加费明细须为有效的非负金额，合计不能超出可比较范围。' };
  } else if (complete && !hasFees) {
    error = { field: 'fees', message: '请至少填写一项已核对的金额，确认无附加费可在合计栏填 0。' };
  }
  return { total: complete && !error ? subtotal : null, subtotal, fees, complete: complete && !error, error };
}

export function normalizeQuoteComparison(input) {
  if (!input || !Array.isArray(input.quotes)) return null;
  const from = scalar(input.shipment?.from).slice(0, 120);
  const to = scalar(input.shipment?.to).slice(0, 120);
  const load = scalar(input.shipment?.load).slice(0, 120);
  const baseCurrency = currencyCode(input.baseCurrency);
  const limit = readNumber(input.deliveryLimitDays);
  if (!from || !to || !load || !FX_CURRENCIES.includes(baseCurrency) || limit.invalid) return null;

  const quotes = [];
  const ids = new Set();
  for (const [index, quote] of input.quotes.slice(0, 8).entries()) {
    if (!quote || typeof quote !== 'object' || Array.isArray(quote)) continue;
    const id = scalar(quote.id).slice(0, 40) || String(index + 1);
    const mode = scalar(quote.mode);
    const scope = scalar(quote.scope) || 'unknown';
    const currency = currencyCode(quote.currency);
    const freight = readNumber(quote.freight);
    const extra = readQuoteExtras(quote);
    const transit = readNumber(quote.transitDays);
    const handoffs = readNumber(quote.handoffs, { integer: true });
    const expires = scalar(quote.expires);
    if (ids.has(id) || !Object.hasOwn(LOGISTICS_MODES, mode) || !Object.hasOwn(LOGISTICS_SCOPES, scope) ||
        !FX_CURRENCIES.includes(currency) || (freight.value === null && transit.value === null) ||
        freight.invalid || extra.error || transit.invalid || handoffs.invalid || (expires && !validDate(expires))) continue;
    ids.add(id);
    quotes.push({
      id, label: scalar(quote.label).slice(0, 100), mode, currency, scope, freight: freight.value,
      extras: extra.fees ? null : extra.total, transitDays: transit.value, handoffs: handoffs.value, expires,
      backup: quote.backup === true,
      ...(extra.fees ? { fees: extra.fees, feesComplete: extra.complete } : {}),
    });
  }
  if (quotes.length < 2) return null;
  return { shipment: { from, to, load }, quotes, baseCurrency, deliveryLimitDays: limit.value };
}

function validRate(rate) {
  return typeof rate === 'number' && Number.isFinite(rate) && rate > 0;
}

export async function fetchFxRates(baseCurrency, quoteCurrencies, { fetchImpl = globalThis.fetch, signal } = {}) {
  const base = currencyCode(baseCurrency);
  if (!base) throw new Error('请选择有效的比较币种。');
  const requested = [...new Set(quoteCurrencies.map(currencyCode))].filter(code => code && code !== base);
  const rates = {};
  const dates = {};
  const result = { base, rates, dates, source: FX_SOURCE };
  if (!requested.length) return result;
  if (!FX_CURRENCIES.includes(base)) throw new Error('ECB 参考汇率暂不支持所选比较币种。');
  const supported = requested.filter(code => FX_CURRENCIES.includes(code));
  if (!supported.length) return result;

  const url = new URL(FX_SOURCE.endpoint);
  url.searchParams.set('base', base);
  url.searchParams.set('quotes', supported.join(','));
  const response = await fetchImpl(url.href, { signal, credentials: 'omit', referrerPolicy: 'no-referrer' });
  if (!response.ok) throw new Error(`参考汇率服务暂不可用（HTTP ${response.status}）。`);
  const rows = await response.json();
  if (!Array.isArray(rows)) throw new Error('参考汇率服务返回了无效数据。');

  for (const row of rows) {
    if (row?.base !== base || !supported.includes(row.quote) || !validRate(row.rate) || !validDate(row.date)) continue;
    if (dates[row.quote] && dates[row.quote] > row.date) continue;
    rates[row.quote] = row.rate;
    dates[row.quote] = row.date;
  }
  return result;
}

function shipmentFlags(shipment) {
  const flags = [];
  const start = scalar(shipment.from) || scalar(shipment.exportCountry) || scalar(shipment.origin);
  const end = scalar(shipment.to) || scalar(shipment.destination);
  if (!start || !end) {
    flags.push({ code: 'lane-missing', text: '确认所有报价使用相同的起运地和目的地。' });
  } else if (start.toLowerCase() !== end.toLowerCase()) {
    flags.push({ code: 'lane-verify', text: '核对实际运输线路、经停地点及各段费用和时间；跨境运输另核对口岸、申报和提送货安排。' });
  }
  if (!scalar(shipment.load)) {
    flags.push({ code: 'load-missing', text: '核对各方案是否使用相同货量、包装尺寸和计费单位。' });
  }
  const goods = [shipment.product, shipment.material, shipment.notes].map(scalar).join(' ');
  if (/电池|锂电|化学品|易燃|危险品|冷链|冷冻|易腐|液体|粉末|\b(?:batter(?:y|ies)|lithium|chemicals?|flammable|hazmat|perishable|refrigerated|liquid|powder)\b/i.test(goods)) {
    flags.push({ code: 'goods-conditions', text: '货物描述可能涉及特殊承运条件。向承运人确认所需包装、温控、申报、检测与接受条件。' });
  }
  return flags;
}

function evaluateQuote(quote, index, baseCurrency, deliveryLimitDays, today, fx) {
  const errors = [];
  const flags = [];
  function flag(code, text) { flags.push({ code, text }); }
  function error(field, message) { errors.push({ field, message }); }

  const id = scalar(quote.id) || String(index + 1);
  const label = scalar(quote.label);
  const mode = scalar(quote.mode);
  const currency = currencyCode(quote.currency);
  const scope = scalar(quote.scope) || 'unknown';
  const freight = readNumber(quote.freight);
  const extras = readQuoteExtras(quote);
  const transit = readNumber(quote.transitDays);
  const handoffs = readNumber(quote.handoffs, { integer: true });
  const backup = quote.backup === true || /^yes$/i.test(scalar(quote.backup));
  const expires = scalar(quote.expires);

  if (!Object.hasOwn(LOGISTICS_MODES, mode)) error('mode', '请选择运输方式。');
  else flag('mode-check', MODE_FLAGS[mode]);
  if (!currency) error('currency', '请选择有效的报价币种。');
  if (!Object.hasOwn(LOGISTICS_SCOPES, scope)) error('scope', '请选择有效的服务范围。');
  if (scope === 'unknown') flag('scope-unknown', '确认报价起止点和承运人负责的服务范围。');
  if (freight.value === null) error('freight', '请填写有效的非负运输报价。');
  if (extras.error) errors.push(extras.error);
  else if (extras.total === null) flag('extras-unknown', '额外费用尚未确认，仅显示已知小计。');
  if (transit.invalid) error('transitDays', '运输时效须为非负天数。');
  else if (transit.value === null) flag('transit-unknown', '向承运人确认相同服务范围内的预计运输时效。');
  if (handoffs.invalid) error('handoffs', '交接次数须为非负整数。');
  else if (handoffs.value > 0 || (mode === 'multimodal' && handoffs.value === null)) {
    flag('handoffs', '确认交接时间、等候费用、风险转移与异常处理方。');
  }
  if (!backup) flag('backup-unknown', '确认是否有可用的备用班次、路线或承运人。');

  let expiryStatus = 'unknown';
  if (!expires) flag('expiry-unknown', '确认报价有效期以及到期后的价格和舱位。');
  else if (!validDate(expires)) error('expires', '请填写有效的报价到期日期。');
  else if (!today) flag('expiry-unverified', '暂时无法核对报价是否已到期。');
  else if (expires < today) {
    expiryStatus = 'expired';
    flag('quote-expired', '报价已过期，请向承运人更新。');
  } else expiryStatus = 'valid';

  const subtotal = freight.value === null || extras.error ? null : freight.value + extras.subtotal;
  const knownCost = subtotal !== null && subtotal <= Number.MAX_SAFE_INTEGER ? subtotal : null;
  if (subtotal !== null && knownCost === null) error('freight', '费用合计超出可比较的金额范围。');
  const costTotal = extras.total === null ? null : knownCost;
  const sameCurrency = Boolean(currency) && currency === baseCurrency;
  const fxDate = currency && baseCurrency && !sameCurrency && fx?.base === baseCurrency && validDate(fx.dates?.[currency])
    ? fx.dates[currency] : null;
  const rate = sameCurrency ? 1 : fxDate && validRate(fx.rates?.[currency]) ? fx.rates[currency] : null;
  // Frankfurter quotes units of the quote currency per unit of the comparison currency.
  const converted = knownCost !== null && rate !== null ? knownCost / rate : null;
  const convertedKnownCost = converted !== null && Number.isFinite(converted) && converted <= Number.MAX_SAFE_INTEGER
    ? converted : null;
  const convertedTotal = costTotal === null ? null : convertedKnownCost;
  if (currency && baseCurrency && !sameCurrency && rate === null) {
    const supported = FX_CURRENCIES.includes(currency) && FX_CURRENCIES.includes(baseCurrency);
    flag('fx-missing', supported ? '尚无可用的同日参考汇率，显示报价原币种。' : 'ECB 参考汇率暂不支持此币种组合，显示报价原币种。');
  } else if (converted !== null && convertedKnownCost === null) {
    flag('fx-out-of-range', '换算金额超出可比较范围，显示报价原币种。');
  }

  let deliveryStatus = 'none';
  if (deliveryLimitDays !== null) {
    deliveryStatus = transit.value === null ? 'unknown' : transit.value <= deliveryLimitDays ? 'within' : 'late';
  }
  if (deliveryStatus === 'late') flag('delivery-late', '预计运输时效超过填写的交付时限。');

  return {
    id, label, mode, currency, scope, freight: freight.value, extras: extras.total,
    ...(extras.fees ? { fees: extras.fees, feesComplete: extras.complete } : {}),
    transitDays: transit.value, handoffs: handoffs.value, backup, expires, expiryStatus,
    knownCost, costTotal, convertedKnownCost, convertedTotal, fxDate: rate === null ? null : fxDate,
    deliveryStatus, flags, errors,
  };
}

function minimum(options, field) {
  return options.reduce((best, option) => !best || option[field] < best[field] ? option : best, null);
}

export function compareLogistics({
  shipment = {}, quotes = [], baseCurrency: baseInput, deliveryLimitDays: limitInput, today: todayInput, fx,
} = {}) {
  const baseCurrency = currencyCode(baseInput);
  const limit = readNumber(limitInput);
  const today = validDate(todayInput) ? scalar(todayInput) : '';
  const errors = [];
  if (!baseCurrency) errors.push({ field: 'baseCurrency', message: '请选择有效的比较币种。' });
  if (limit.invalid) errors.push({ field: 'deliveryLimitDays', message: '交付时限须为非负天数。' });
  const flags = shipmentFlags(shipment || {});
  const options = quotes.map((quote, index) => evaluateQuote(quote || {}, index, baseCurrency, limit.value, today, fx));

  const eligible = options.filter(option => Object.hasOwn(LOGISTICS_MODES, option.mode) &&
    option.expiryStatus !== 'expired' && (!option.expires || option.expiryStatus === 'valid'));
  const scopes = new Set(eligible.map(option => option.scope));
  const comparable = scopes.size === 1 && !scopes.has('unknown') &&
    Object.hasOwn(LOGISTICS_SCOPES, eligible[0].scope);
  if (eligible.length > 0 && !comparable) {
    flags.push({ code: 'scope-mismatch', text: '服务范围存在差异或尚未确认，暂不比较最低费用和最短时效。' });
  }

  const priced = comparable ? eligible.filter(option => option.convertedTotal !== null) : [];
  const timed = comparable ? eligible.filter(option => option.transitDays !== null) : [];
  if (priced.length > 0 && priced.length < eligible.length) {
    flags.push({ code: 'cost-subset', text: '最低费用仅在已知完整费用和可用汇率的方案中比较。' });
  }
  if (timed.length > 0 && timed.length < eligible.length) {
    flags.push({ code: 'time-subset', text: '最短时效仅在已填预计运输时效的方案中比较。' });
  }
  const fxDates = new Set(priced.map(option => option.fxDate).filter(Boolean));
  if (fxDates.size > 1) {
    flags.push({ code: 'fx-date-mismatch', text: '换算汇率对应的日期不同，暂不比较最低费用。' });
  }
  const costs = fxDates.size > 1 ? [] : priced;
  const withinLimit = limit.value === null ? [] : costs.filter(option => option.deliveryStatus === 'within');
  return {
    baseCurrency, deliveryLimitDays: limit.value, errors, flags, options,
    cheapest: minimum(costs, 'convertedTotal'),
    cheapestWithinLimit: minimum(withinLimit, 'convertedTotal'),
    fastest: minimum(timed, 'transitDays'),
  };
}
