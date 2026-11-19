import { lookupTariff } from './tariffs.js';
import { FX_CURRENCIES, FX_SOURCE, LOGISTICS_MODES, LOGISTICS_SCOPES, compareLogistics, fetchFxRates } from './logistics.js';

const markets = {
  US: { name: '美国海关税则（USITC）', url: 'https://hts.usitc.gov/' },
  GB: { name: '英国 Online Trade Tariff', url: 'https://www.gov.uk/trade-tariff' },
  EU: { name: '欧盟 Access2Markets', url: 'https://trade.ec.europa.eu/access-to-markets/en/home' },
  OTHER: { name: 'WTO 关税数据入口', url: 'https://www.wto.org/english/tratop_e/tariffs_e/tariff_data_e.htm' },
};
const tariffStatuses = {
  invalid: '请输入 6、8 或 10 位税则编码。',
  unsupported: '该市场请使用官方查询入口继续核验。',
  'not-found': '未查到匹配税则项。请核对编码位数及目的市场。',
  unavailable: '暂时无法获取官方税则。你仍可打开官方入口核验。',
  candidates: '找到候选税则项。请按货物实际规格核对完整编码。',
  found: '已查询到官方税则项。',
};

const element = (tag, text = '', className = '') => {
  const node = document.createElement(tag);
  node.textContent = text;
  if (className) node.className = className;
  return node;
};

function marketFor(destination) {
  const name = (destination || '').trim().toLowerCase();
  if (/北爱尔兰|northern ireland/.test(name)) return 'OTHER';
  if (/^(美国|united states|usa?|u\.s\.)(?:$|[\s，,（(/])/.test(name)) return 'US';
  if (/^(英国|大不列颠|united kingdom|great britain|uk|gb)(?:$|[\s，,（(/])/.test(name)) return 'GB';
  if (/^(欧盟|德国|法国|意大利|西班牙|荷兰|波兰|eu|germany|france|italy|spain|netherlands)(?:$|[\s，,（(/])/.test(name)) return 'EU';
  return name ? 'OTHER' : '';
}

function quoteCurrency(currency) {
  const code = (currency || '').trim().toUpperCase();
  return FX_CURRENCIES.includes(code) ? code : 'USD';
}

function calendarDate() {
  const today = new Date();
  return [today.getFullYear(), today.getMonth() + 1, today.getDate()]
    .map((part, index) => String(part).padStart(index ? 2 : 4, '0')).join('-');
}

function formatMoney(amount, currency) {
  return new Intl.NumberFormat('zh-CN', { style: 'currency', currency, currencyDisplay: 'code' }).format(amount);
}

function setOptions(select, entries, value) {
  select.replaceChildren(...entries.map(([id, label]) => new Option(label, id)));
  select.value = value;
}

function renderFlags(flags, parent) {
  if (!flags.length) return;
  const list = element('ul', '', 'planning-flags');
  for (const { text } of flags) list.append(element('li', text));
  parent.append(list);
}

function renderTariffRows(result, threshold, queryCode) {
  const fragment = document.createDocumentFragment();
  const fetched = result.fetchedAt ? ' · ' + new Date(result.fetchedAt).toLocaleString('zh-CN') : '';
  fragment.append(element('p', result.sourceName + fetched, 'planning-help'));
  for (const row of result.rows) {
    const item = element('article', '', 'planning-result');
    const head = element('div', '', 'planning-result-head');
    head.append(element('h4', row.code));
    const rate = /^(\d+(?:\.\d+)?)\s*%$/.exec(row.general.trim());
    if (result.status === 'found' && rate && !/^(98|99)/.test(row.code) && Number(rate[1]) >= threshold) {
      head.append(element('span', `达到关注线 ${threshold}%`, 'planning-badge caution'));
    }
    item.append(head);
    if (row.description) item.append(element('p', row.description));
    if (row.general) item.append(element('p', `基础税率 · ${row.general}`));
    if (row.rateCode && row.rateCode !== row.code) item.append(element('p', `基础税率对应税则项 ${row.rateCode}`, 'planning-help'));
    if (row.special) item.append(element('p', `特别栏 · ${row.special}`, 'planning-help'));
    if (row.other) item.append(element('p', `其他税率栏 · ${row.other}`, 'planning-help'));
    if (row.hasNotes) item.append(element('p', '此税则项附有注释，请在官方页面核验。', 'planning-help'));
    if (result.status === 'candidates') {
      const button = element('button', `用 ${row.code} 再查询`, 'case-link');
      button.type = 'button';
      button.addEventListener('click', () => queryCode(row.code));
      item.append(button);
    }
    fragment.append(item);
  }
  if (result.totalRows > result.rows.length) {
    fragment.append(element('p', `另有 ${result.totalRows - result.rows.length} 个匹配项，完整列表见官方入口。`, 'planning-help'));
  }
  return fragment;
}

function renderComparison(result, basis, demo) {
  const fragment = document.createDocumentFragment();
  fragment.append(element('p', `${basis.from} → ${basis.to} · ${basis.load}`, 'planning-basis'));
  if (demo) fragment.append(element('p', '演示报价仅用于体验比较流程。', 'planning-help'));
  for (const { message } of result.errors) fragment.append(element('p', message, 'planning-help'));
  renderFlags(result.flags, fragment);

  for (const option of result.options) {
    const item = element('article', '', 'planning-result');
    const head = element('div', '', 'planning-result-head');
    const title = option.label || LOGISTICS_MODES[option.mode] || '运输方案';
    head.append(element('h4', title));
    for (const [choice, label] of [
      [result.cheapest, '完整报价最低'],
      [result.fastest, '已知时效最快'],
      [result.cheapestWithinLimit, '限期内报价最低'],
    ]) {
      if (choice?.id === option.id) head.append(element('span', label, 'planning-badge'));
    }
    item.append(head);
    item.append(element('p', `${LOGISTICS_MODES[option.mode] || '运输方式待确认'} · ${LOGISTICS_SCOPES[option.scope] || '报价范围待确认'}`, 'planning-help'));
    if (option.costTotal != null) {
      item.append(element('p', `已确认报价合计 · ${formatMoney(option.costTotal, option.currency)}`, 'quote-total'));
    } else if (option.knownCost != null) {
      item.append(element('p', `已知费用 · ${formatMoney(option.knownCost, option.currency)}（总额待补）`, 'quote-total'));
    }
    const converted = option.convertedTotal ?? option.convertedKnownCost;
    if (converted != null && option.currency !== result.baseCurrency) {
      item.append(element('p', `参考折算 · ${formatMoney(converted, result.baseCurrency)}${option.fxDate ? ' · ' + option.fxDate : ''}`, 'planning-help'));
    }
    const transit = option.transitDays == null ? '时效待确认' : `预计 ${option.transitDays} 天`;
    const limit = { within: ' · 满足时限', late: ' · 超出时限', unknown: ' · 时限待核验' }[option.deliveryStatus] || '';
    item.append(element('p', transit + limit));
    for (const { message } of option.errors) item.append(element('p', message, 'planning-help'));
    renderFlags(option.flags, item);
    fragment.append(item);
  }
  return fragment;
}

export function createTradePlanner(initialShipment = {}) {
  const root = document.querySelector('#planningDialog');
  const get = selector => root.querySelector(selector);
  const tabs = [...root.querySelectorAll('[data-planning-tab]')];
  const tariffs = get('#tradeTariffForm');
  const logistics = get('#tradeLogisticsForm');
  const quoteList = get('#quoteOptions');
  const tariffStatus = get('#tariffStatus');
  const logisticsStatus = get('#logisticsStatus');
  const tariffResults = get('#tariffResults');
  const logisticsResults = get('#logisticsResults');
  const officialLink = get('#tariffOfficialLink');
  const lookup = get('#lookupTariff');
  const compare = get('#compareQuotes');
  const currencies = FX_CURRENCIES.map(code => [code, code]);
  let shipment;
  let tariffRequest;
  let fxRequest;
  let demo = false;
  let quoteId = 0;

  function activate(tab) {
    for (const button of tabs) {
      const selected = button.dataset.planningTab === tab;
      button.setAttribute('aria-pressed', String(selected));
      get('#' + button.getAttribute('aria-controls')).hidden = !selected;
    }
  }

  function invalidateTariffs() {
    tariffRequest?.abort();
    tariffRequest = null;
    tariffResults.replaceChildren();
    tariffStatus.textContent = '';
    const market = markets[tariffs.elements.destination.value] || markets.OTHER;
    officialLink.href = market.url;
    officialLink.textContent = market.name + ' ↗';
    lookup.disabled = false;
  }

  function invalidateComparison() {
    fxRequest?.abort();
    fxRequest = null;
    logisticsResults.replaceChildren();
    logisticsStatus.textContent = '';
    compare.disabled = false;
  }

  function refreshQuoteControls() {
    const rows = [...quoteList.children];
    rows.forEach((row, index) => {
      row.querySelector('legend').textContent = `运输方案 ${index + 1}`;
      row.querySelector('.quote-remove').disabled = rows.length <= 2;
    });
    get('#addQuote').disabled = rows.length >= 8;
  }

  function addQuote(values = {}, focus = false) {
    const row = document.querySelector('#quoteTemplate').content.firstElementChild.cloneNode(true);
    row.dataset.id = String(++quoteId);
    const inputs = Object.fromEntries([...row.querySelectorAll('[data-quote]')].map(input => [input.dataset.quote, input]));
    setOptions(inputs.mode, Object.entries(LOGISTICS_MODES), values.mode || 'ocean');
    setOptions(inputs.scope, Object.entries(LOGISTICS_SCOPES), values.scope || 'unknown');
    setOptions(inputs.currency, currencies, values.currency || logistics.elements.baseCurrency.value);
    for (const key of ['label', 'freight', 'extras', 'transitDays', 'handoffs', 'expires']) {
      inputs[key].value = values[key] ?? '';
    }
    inputs.backup.checked = Boolean(values.backup);
    row.querySelector('.quote-remove').addEventListener('click', () => {
      row.remove();
      refreshQuoteControls();
      invalidateComparison();
      get('#addQuote').focus();
    });
    quoteList.append(row);
    refreshQuoteControls();
    if (focus) inputs.label.focus();
  }

  function setShipment(nextShipment, force = false) {
    if (!force && shipment === nextShipment) return;
    shipment = nextShipment;
    demo = false;
    tariffs.reset();
    logistics.reset();
    tariffs.elements.destination.value = marketFor(shipment.destination);
    tariffs.elements.code.value = shipment.hs || '';
    logistics.elements.from.value = shipment.exportCountry || shipment.origin || '';
    logistics.elements.to.value = shipment.destination || '';
    setOptions(logistics.elements.baseCurrency, currencies, quoteCurrency(shipment.currency));
    quoteList.replaceChildren();
    addQuote();
    addQuote({ mode: 'multimodal' });
    invalidateTariffs();
    invalidateComparison();
    get('#planningContext').textContent = shipment.product
      ? `当前货物 · ${shipment.product}`
      : '按目的市场查税率，用同一票货的报价对比运输方案。';
  }

  for (const button of tabs) button.addEventListener('click', () => activate(button.dataset.planningTab));
  tariffs.addEventListener('input', invalidateTariffs);
  logistics.addEventListener('input', invalidateComparison);
  get('#addQuote').addEventListener('click', () => {
    addQuote({}, true);
    invalidateComparison();
  });
  get('#fillPlanningExample').addEventListener('click', () => {
    invalidateComparison();
    demo = true;
    logistics.elements.from.value = '上海';
    logistics.elements.to.value = '鹿特丹';
    logistics.elements.load.value = '1 × 40HQ';
    logistics.elements.deliveryLimitDays.value = '30';
    logistics.elements.baseCurrency.value = 'USD';
    quoteList.replaceChildren();
    addQuote({ label: '演示 · 全程海运', mode: 'ocean', scope: 'door-to-door', currency: 'USD', freight: 2900, extras: 750, transitDays: 38, handoffs: 1 });
    addQuote({ label: '演示 · 铁路＋公路', mode: 'multimodal', scope: 'door-to-door', currency: 'USD', freight: 3900, extras: 500, transitDays: 22, handoffs: 3, backup: true });
    logisticsStatus.textContent = '已填入演示报价。';
  });

  tariffs.addEventListener('submit', async event => {
    event.preventDefault();
    invalidateTariffs();
    const { destination, code, threshold } = Object.fromEntries(new FormData(tariffs));
    if (!destination) {
      tariffStatus.textContent = '请选择进口市场。';
      return;
    }
    if (!['US', 'GB'].includes(destination)) {
      tariffStatus.textContent = tariffStatuses.unsupported;
      return;
    }
    const controller = new AbortController();
    tariffRequest = controller;
    lookup.disabled = true;
    tariffStatus.textContent = '正在查询官方税则…';
    try {
      const result = await lookupTariff({ destination, code }, { signal: controller.signal });
      if (tariffRequest !== controller) return;
      tariffStatus.textContent = tariffStatuses[result.status] || tariffStatuses.unavailable;
      if (result.sourceUrl && (destination === 'US' || result.rows.length)) officialLink.href = result.sourceUrl;
      if (result.rows.length) {
        tariffResults.append(renderTariffRows(result, threshold === '' ? Infinity : Number(threshold), nextCode => {
          tariffs.elements.code.value = nextCode;
          tariffs.elements.code.focus();
          tariffs.requestSubmit();
        }));
      }
    } catch {
      if (tariffRequest === controller) tariffStatus.textContent = tariffStatuses.unavailable;
    } finally {
      if (tariffRequest === controller) {
        tariffRequest = null;
        lookup.disabled = false;
      }
    }
  });

  logistics.addEventListener('submit', async event => {
    event.preventDefault();
    invalidateComparison();
    const { from, to, load, deliveryLimitDays, baseCurrency } = Object.fromEntries(new FormData(logistics));
    const basis = { from: from.trim(), to: to.trim(), load: load.trim() };
    if (Object.values(basis).some(value => !value)) {
      logisticsStatus.textContent = '请填写共同起点、终点和货量，确认各报价基于同一票货。';
      return;
    }
    const quotes = [...quoteList.children].map(row => ({
      id: row.dataset.id,
      ...Object.fromEntries([...row.querySelectorAll('[data-quote]')].map(input => [
        input.dataset.quote, input.type === 'checkbox' ? input.checked : input.value,
      ])),
    })).filter(quote => quote.freight !== '' || quote.transitDays !== '');
    if (quotes.length < 2) {
      logisticsStatus.textContent = '请至少为两个方案填写运费或时效。';
      return;
    }

    const quoteCurrencies = [...new Set(quotes.map(quote => quote.currency))].filter(code => code !== baseCurrency);
    let fx = null;
    let fxNote = '';
    if (quoteCurrencies.length) {
      const controller = new AbortController();
      fxRequest = controller;
      compare.disabled = true;
      logisticsStatus.textContent = '正在获取参考汇率…';
      try {
        const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]);
        fx = await fetchFxRates(baseCurrency, quoteCurrencies, { signal });
        fxNote = `汇率来源 · ${FX_SOURCE.name}。银行结算价可能不同。`;
      } catch {
        fxNote = '暂时无法获取参考汇率。缺少汇率的报价仍显示原币金额。';
      }
      if (fxRequest !== controller) return;
      fxRequest = null;
      compare.disabled = false;
    }
    const result = compareLogistics({
      shipment: { ...shipment, ...basis },
      quotes, baseCurrency, deliveryLimitDays, today: calendarDate(), fx,
    });
    logisticsResults.append(renderComparison(result, basis, demo));
    logisticsStatus.textContent = fxNote || '已比较所填方案。';
    if (fx) {
      const source = element('a', '查看参考汇率来源 ↗', 'case-link');
      source.href = FX_SOURCE.url;
      source.target = '_blank';
      source.rel = 'noopener noreferrer';
      logisticsResults.append(source);
    }
  });

  setShipment(initialShipment, true);
  return { activate, setShipment };
}
