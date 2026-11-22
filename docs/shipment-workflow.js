import { LOGISTICS_MODES } from './logistics.js';

export const WORKFLOW_MODES = LOGISTICS_MODES;

export const WORKFLOW_STAGES = Object.freeze({
  prepare: '资料准备',
  booking: '订舱或订车',
  handover: '交货与交接',
  transit: '主运输与转运',
  clearance: '进口清关',
  delivery: '末端派送',
  complete: '归档与结案',
});

export const WORKFLOW_INCIDENTS = Object.freeze({
  missed_cutoff: '错过截单或截货',
  rolled: '甩柜、漏装或舱位调整',
  delayed: '延误或错过衔接',
  customs_hold: '海关查验或暂缓放行',
  document_discrepancy: '运输或申报单证不一致',
  damage: '货损、短少或封识异常',
  delivery_refused: '目的地拒收或无法签收',
  extra_charges: '额外费用或账单争议',
});

const TERMS = {
  EXW: {
    title: '工厂交货',
    cost: '卖方在指定地点备货。买方安排装货和主运输，并核对提货条件。',
    risk: '货物在指定地点备妥并置于买方处置之下时转移风险，通常在装车之前。',
    customs: '买方办理出口和进口手续。若买方无法在出口地办理出口，确认合同及报关安排。',
  },
  FCA: {
    title: '货交承运人',
    cost: '卖方将货物交给买方指定的承运人。买方通常安排并支付主运输。',
    risk: '卖方场地交货时，装上买方安排的运输工具后转移；其他指定地点交货时，卖方车辆抵达并备妥卸货时转移。',
    customs: '卖方办理出口手续，买方办理进口手续。',
  },
  CPT: {
    title: '运费付至',
    cost: '卖方支付到指定目的地的运输费。双方确认哪些场站与卸货费已计入运输合同。',
    risk: '风险在指定交货点交承运人时转移。多段运输应明确交货点，避免将付费到达地当成交货点。',
    customs: '卖方办理出口手续，买方办理进口手续。卖方无需替买方投保。',
  },
  CIP: {
    title: '运费及保险费付至',
    cost: '卖方支付到指定目的地的运费和约定的货运保险费。',
    risk: '风险在指定交货点交承运人时转移。多段运输应在合同中明确交货点。',
    customs: '卖方办理出口手续，买方办理进口手续。除另有约定，核对保险是否达到类似协会货物保险条款 (A) 的范围。',
  },
  DAP: {
    title: '目的地交货',
    cost: '卖方支付运至指定目的地的成本。买方通常安排卸货，具体费用仍需查看运输合同。',
    risk: '运输工具抵达指定目的地，货物备妥卸货并交由买方处置时转移。',
    customs: '卖方办理出口及适用过境手续，买方办理进口并支付相应税费。',
  },
  DPU: {
    title: '目的地卸货后交货',
    cost: '卖方安排并支付运至指定目的地及卸货的成本，应事先确认现场可卸货。',
    risk: '货物在指定目的地卸下并交由买方处置时转移。',
    customs: '卖方办理出口及适用过境手续，买方办理进口并支付相应税费。',
  },
  DDP: {
    title: '完税后交货',
    cost: '卖方支付运至指定目的地的运输与进口税费。买方通常安排卸货，具体费用仍需查看运输合同。',
    risk: '货物在指定目的地备妥卸货并交由买方处置时转移。',
    customs: '卖方负责出口、适用过境及进口手续。先核实卖方能否在目的地合法办理进口与相关税务手续。',
  },
  FAS: {
    title: '船边交货',
    cost: '卖方把货物送至指定装运港买方指定船舶的船边。买方通常承担装船及海运成本。',
    risk: '货物在指定装运港置于指定船舶的船边时转移。',
    customs: '卖方办理出口手续，买方办理进口手续。',
  },
  FOB: {
    title: '船上交货',
    cost: '卖方承担货物装上指定装运港船舶前的成本，买方通常支付主运费。',
    risk: '货物在指定装运港装上买方指定船舶时转移。',
    customs: '卖方办理出口手续，买方办理进口手续。若货物先交给集装箱场站，复核 FCA 是否更符合实际交接。',
  },
  CFR: {
    title: '成本加运费',
    cost: '卖方支付到指定目的港的运费。核对目的港装卸和附加费用的合同分配。',
    risk: '货物在装运港交到船上时转移。',
    customs: '卖方办理出口手续，买方办理进口手续。卖方无需替买方投保。',
  },
  CIF: {
    title: '成本、保险费加运费',
    cost: '卖方支付到指定目的港的运费和约定的保险费。',
    risk: '货物在装运港交到船上时转移。',
    customs: '卖方办理出口手续，买方办理进口手续。除另有约定，核对类似协会货物保险条款 (C) 的最低保障是否满足货物需要。',
  },
  DDU: {
    title: '未完税交货（历史术语）',
    cost: '若合同确实采用 Incoterms 2000，通常由卖方承担运抵指定地点的成本，进口手续及相关税费由买方承担。',
    risk: '若合同采用该历史版本，通常在货物抵达指定地点、备妥卸货时转移。应核对双方签订的版本和交货约定。',
    customs: '由双方复核实际合同、进口申报人及迟延清关责任。现行订单应写明双方确认的术语、地点与版本。',
  },
};

const SEA_TERMS = new Set(['FAS', 'FOB', 'CFR', 'CIF']);
const TERM_CODES = Object.keys(TERMS).join('|');
const ALTERNATIVE_TERM = new RegExp('(?:^|[ /／、,，]|或)(?:' + TERM_CODES + ')(?=[ /／、,，]|或|$)', 'i');
const QUESTION_TERM = new RegExp('(?<![A-Za-z0-9])(?:' + TERM_CODES + ')(?![A-Za-z0-9])', 'gi');
const TERM_VERSION = /\bIncoterms?\s*[®:：-]?\s*(19\d{2}|20\d{2})\b/i;
const TRAILING_VERSION = /(?:^|\s|(?=[(（]))[(（]?(2000|2010|2020)[)）]?\s*$/;

const MODE_ALIASES = {
  ocean: ['ocean', 'sea', 'ocean freight', 'sea freight', '海运', '水运'],
  rail: ['rail', 'rail freight', '铁路', '铁路运输', '班列'],
  air: ['air', 'air freight', '空运', '航空运输'],
  road: ['road', 'trucking', 'truck', '公路', '公路运输', '汽运'],
  multimodal: ['multimodal', 'intermodal', '多式联运', '联运'],
};

const ENGLISH_MODES = {
  ocean: 'Ocean freight',
  rail: 'Rail freight',
  air: 'Air freight',
  road: 'Road freight',
  multimodal: 'Multimodal transport',
};

const MILESTONES = [
  ['prepare', '发货方／报关行', '核对品名、编码、件数、包装、起讫地点和单证版本，确认货物备妥时间。'],
  ['booking', '订舱方／承运人', '核对舱位或运力、截单与截货时间、各段报价包含项和条款有效期。'],
  ['handover', '发货方／承运人', '按指定地点与时窗交货，核对货件和外包装，索取签收凭据。'],
  ['transit', '承运人／货代', '核对实际发运与预计到达时间，确认超出时窗由谁反馈和处理。'],
  ['clearance', '进口方／报关行', '在到货前确认申报主体、单证与可能的许可要求，并等待主管机关放行。'],
  ['delivery', '承运人／收货方', '确认预约、卸货责任、费用与送达签收。'],
  ['complete', '发货方／收货方', '保存运单、放行及签收凭据，核对最终账单并记录待处理的异常。'],
];

const MODE_HANDOFFS = {
  ocean: {
    booking: '确认班轮与订舱确认书，区分截单、截港与适用的核实总重（VGM）截止时间。',
    handover: '记录集装箱号、封识号、进港时间和场站交接凭据，核对装船确认。',
    transit: '核对实际起航、中转装船与到港通知，并确认免用箱、免堆存期限。',
    delivery: '确认提货预约、空箱返还地点与时限，保存签收及还箱凭据。',
  },
  rail: {
    booking: '确认班列、始发与终到场站、进站截单截货时间以及跨境换装安排。',
    handover: '核对箱号、封识和铁路运单，保存进站交接凭据。',
    transit: '核对始发、中转口岸、换装或换轨及到站记录，确认跨境等待由谁反馈。',
  },
  air: {
    booking: '确认航班舱位、货站交仓截止时间、计费重量和安检或特殊货接受条件。',
    handover: '核对航司或货站收货记录、航空运单和安检状态。',
    transit: '核对实装航班、中转航班衔接和到港货站通知，必要时确认托盘拆分。',
  },
  road: {
    booking: '确认车型与装载限制、提送货预约、跨境口岸及驾驶与通行安排。',
    handover: '核对司机与车号、封识及交货数量，保存公路承运签收记录。',
    transit: '核对过境口岸、换车交接或排队信息，记录责任方更新的到达时间。',
  },
  multimodal: {
    booking: '确认每段承运人、订舱编号、换装地点、接驳时窗与全程合同负责人。',
    handover: '记录各段的交接点、签收人、件数和封识，明确谁负责下一段接驳。',
    transit: '逐段核对到站、卸载与下一段装载确认，复核全程运单和保险覆盖的衔接点。',
  },
};

const BASE_DOCUMENTS = [
  ['商业发票', '核对交易方、品名、币种、金额以及合同的术语、版本和地点。'],
  ['装箱单', '核对件数、包装编号、毛净重及尺寸，并与发票和运输单证交叉检查。'],
  ['出口与进口申报资料', '确认申报主体、货物信息与所需许可。如申请优惠待遇，另核验适用原产地证明。'],
];

const MODE_DOCUMENTS = {
  ocean: [
    ['海运提单或海运单', '逐项核对托收放货安排、通知方、装卸港、箱号和封识。'],
    ['适用的集装箱 VGM 记录', '确认由谁取得并报送核实总重，保存测量和提交凭据。'],
  ],
  rail: [
    ['铁路运单', '与承运人确认适用运单格式（如 CIM / SMGS），核对场站、换装点和收发信息。'],
  ],
  air: [
    ['航空运单', '确认主运单和适用的分运单，并核对航班与计费重量。'],
    ['货站接受与特殊货文件', '向承运人确认特殊货、危险品或温控接受要求及实际所需声明。'],
  ],
  road: [
    ['公路运输单证', '核对承运人、司机、车辆、交接地点和签收栏。跨境运输确认是否适用 CMR 运单。'],
  ],
  multimodal: [
    ['全程运单与分段运单', '核对签发人、各段承运人、接驳点和最终交货地，保存每段交接凭据。'],
    ['保险凭证与接驳记录', '核对转运、临时存放及换装是否在承保期间与范围内。'],
  ],
  unspecified: [
    ['运输单证', '向订舱方或承运人确认适用的运单、运输凭证与签收要求。'],
  ],
};

const INCIDENT_STEPS = {
  missed_cutoff: [
    '向承运人确认错过的是截单、截货、截港还是资料报送期限。保留正式通知、时区和交付记录。',
    '确认是否接受补交或改配，取得新的订舱、场站预约与费用的书面确认。',
    '更新关联运输段与单证交付期限，请责任方确认新的时间表。',
  ],
  rolled: [
    '请承运人书面确认是否按时交付却未装船、实际未装原因及当前箱货位置，留存进场和订舱凭据。',
    '核对下一航次、可用舱位、单证能否沿用，以及堆存、调箱和改配费用由谁承担。',
    '确认书面改配方案后更新接续运输、报关与收货安排，记录新截止日和下次确认时间。',
  ],
  delayed: [
    '向当前承运人核实实际位置、延误原因和下一次更新时点，并保留书面记录。',
    '和接续承运人核对是否仍能衔接，取得可选班次、费用和交货影响。',
    '同步报关行和收货方，更新预计到达、预约与免费使用期限。',
  ],
  customs_hold: [
    '请适用的报关行取得查验或补件通知，确认要求、回复时限和提交责任人。',
    '保存现有申报与交易单证，逐项核对主管机关所需的证明，并经正规渠道补交。',
    '向承运人核对场站或仓储费用，等待主管机关正式放行后更新后续安排。',
  ],
  document_discrepancy: [
    '找到不一致的字段及版本，对照原始合同、装运记录和实际货物。',
    '联系原签发方或报关行确认修改权限、方式与期限，留存批准与修订单。',
    '向需要新版文件的各方统一分发，经对方确认后再继续提交。',
  ],
  damage: [
    '交接时记录异常、件数和封识，在签收或检验记录上注明并保存照片。缺件时请承运人核对最后一次交接记录。',
    '及时通知承运人、发货方和适用保险人，按合同核对报损时限与检验安排。',
    '在收到处理意见前保存货物与包装，汇集运输凭据、费用和损失记录。',
  ],
  delivery_refused: [
    '要求收货方和末端承运人记录拒收原因、送达时间和现场情况，保存拒收回单。',
    '确认货物当前保管地点、期限及仓储费，并与进口方核对海关状态和下一份书面指令。',
    '由相关方确认可行的补送、退运或其他处置流程，并核对费用和保险通知要求。',
  ],
  extra_charges: [
    '索取费用名称、币种、计费依据、发生区间及对应承运记录。',
    '与报价含项、合同、操作时间和免费期逐项对照，区分已约定和待确认金额。',
    '在账单异议期限内向开票方提出具体差异，保留书面回复和更正凭据。',
  ],
};

const QUESTION_INCIDENTS = {
  missed_cutoff: /错过(?:截单|截港|截货)|截(?:单|港|货)(?:已过|来不及)|\bmissed (?:the )?cutoff\b/i,
  rolled: /甩柜|甩箱|漏装|爆舱|\b(?:rolled cargo|rollover|rolled booking)\b/i,
  delayed: /(?:船期|航班|货运|货物|运输|提货|到货)延误|晚点|错过(?:中转|接驳)|\b(?:shipment delay|delayed shipment|missed connection)\b/i,
  customs_hold: /查验|扣关|海关扣货|暂缓放行|\b(?:customs hold|customs inspection)\b/i,
  document_discrepancy: /(?:单证|运单|提单|发票|箱单).{0,8}(?:不一致|有误|填错|写错|错误|更正)|\b(?:document discrepancy|incorrect bill of lading)\b/i,
  damage: /货损|货物受损|货物短少|货物破损|丢件|货物丢失|破封|封识异常|\b(?:cargo damage|damaged cargo|cargo loss|missing packages?|broken seal)\b/i,
  delivery_refused: /拒收|无法签收|\b(?:delivery refused|refused delivery)\b/i,
  extra_charges: /滞箱费|滞港费|滞期费|账单争议|超额附加费|\b(?:demurrage|detention charges|unexpected freight charges)\b/i,
};

const QUESTION_MODES = {
  ocean: /海运|船运|\b(?:ocean freight|sea freight)\b/i,
  rail: /铁路运输|铁路|班列|\brail freight\b/i,
  air: /空运|航空运输|\bair freight\b/i,
  road: /公路运输|汽运|\b(?:road freight|trucking)\b/i,
  multimodal: /多式联运|\b(?:multimodal|intermodal)\b/i,
};
const QUESTION_OPERATION = /流程|操作步骤|节点|交接|订舱|订车|截单|截货|装船|安排|单证|文件|\b(?:workflow|checklist|handoff|handover|cutoff|booking|documents?)\b/i;

function text(value, limit = 160) {
  if (typeof value !== 'string' && !Number.isFinite(value)) return '';
  return String(value).slice(0, limit * 2)
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069]/g, ' ')
    .replace(/\s+/g, ' ').trim().slice(0, limit).trimEnd();
}

function selected(value, catalog) {
  return typeof value === 'string' && Object.hasOwn(catalog, value) ? value : '';
}

function modeFor(shipment, details) {
  const requestedMode = text(shipment?.transport, 40).toLowerCase();
  return selected(details?.mode, WORKFLOW_MODES) ||
    Object.keys(MODE_ALIASES).find(mode => MODE_ALIASES[mode].includes(requestedMode)) || '';
}

function termFor(incoterm, namedPlace) {
  const entered = text(incoterm, 140);
  const match = /^([A-Za-z]{3})(?![A-Za-z0-9])/.exec(entered);
  const code = match?.[1].toUpperCase();
  const suffix = match ? entered.slice(match[0].length).trim() : '';
  const place = text(namedPlace, 120);
  if (!Object.hasOwn(TERMS, code) || /^[\/／、,，]|^或|^or\b/i.test(suffix) || ALTERNATIVE_TERM.test(suffix)) {
    return {
      code: '',
      title: '贸易术语待确认',
      place,
      note: '请填写合同中的单一贸易术语、指定地点与版本，再确认运输和交接责任。',
      version: '',
    };
  }

  const version = TERM_VERSION.exec(suffix)?.[1] || TRAILING_VERSION.exec(suffix)?.[1] || '';
  const suffixPlace = suffix
    .replace(/[(（]?\bIncoterms?\s*[®:：-]?\s*(?:19\d\d|20\d\d)?[)）]?\s*$/i, '')
    .replace(TRAILING_VERSION, '')
    .replace(/^[\s:：,，;-]+|[\s:：,，;-]+$/g, '').trim();
  const note = code === 'DDU'
    ? 'DDU 出现在 Incoterms 2000。现行 Incoterms 2020 已无这一术语，应按签署版本和合同核对。'
    : version && version !== '2020'
      ? '已填写 Incoterms ' + version + '。请按该版本和实际合同核对分工。'
      : '下列分工以 Incoterms 2020 为参考。执行前请核对签署版本、指定地点和合同约定。';
  return { code, title: TERMS[code].title, place: place || suffixPlace, note, version };
}

function termResponsibilities({ code, version }) {
  if (!code || (version && version !== (code === 'DDU' ? '2000' : '2020'))) return [];
  const { cost, risk, customs } = TERMS[code];
  return [
    { title: '运输安排与成本', detail: cost },
    { title: '交货及风险转移', detail: risk },
    { title: '报关与其他责任', detail: customs },
  ];
}

function dateValue(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return NaN;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value ? timestamp : NaN;
}

function stageAlerts(stage, dueDate, today) {
  if (stage === 'complete' || !dueDate) return [];
  const now = dateValue(today);
  const deadline = dateValue(dueDate);
  if (!stage || !Number.isFinite(deadline) || !Number.isFinite(now)) {
    return [{ level: 'info', title: '当前节点期限待核对', action: '请选择当前节点，并用有效的 YYYY-MM-DD 日期核对期限。' }];
  }

  const days = (deadline - now) / 86_400_000;
  if (days > 2) return [];
  const title = days < 0 ? '已超过记录期限' : days === 0 ? '记录期限为今天' : '即将到记录期限';
  const action = WORKFLOW_STAGES[stage] + '的记录期限为 ' + dueDate + '。向责任方确认实际进度和下一次更新时间。';
  return [{ level: days < 0 ? 'high' : 'medium', title, action }];
}

export function buildShipmentWorkflow({ shipment = {}, details = {}, today = new Date().toISOString().slice(0, 10) } = {}) {
  const mode = modeFor(shipment, details);
  const stage = selected(details?.stage, WORKFLOW_STAGES);
  const incidentId = selected(details?.incident, WORKFLOW_INCIDENTS);
  const { version, ...term } = termFor(shipment?.incoterm, details?.namedPlace);
  const alerts = stageAlerts(stage, text(details?.dueDate, 40), today);
  if (SEA_TERMS.has(term.code) && mode && mode !== 'ocean') {
    alerts.push({ level: 'medium', title: '核对贸易术语与交货方式', action: term.code + ' 用于船边或船上交货。核实实际交货点及所签术语，尤其是先交给陆运、空运或多式联运承运人时。' });
  }
  if (term.code && !term.place) {
    alerts.push({ level: 'info', title: '尚缺合同指定地点', action: '补充合同注明的具体港口、场站、仓库或交货地址。' });
  }

  return {
    term,
    responsibilities: termResponsibilities({ ...term, version }),
    milestones: MILESTONES.map(([id, owner, fallback]) => ({
      id, title: WORKFLOW_STAGES[id], owner, action: MODE_HANDOFFS[mode]?.[id] || fallback,
    })),
    documents: [...BASE_DOCUMENTS, ...(MODE_DOCUMENTS[mode] || MODE_DOCUMENTS.unspecified)]
      .map(([title, check]) => ({ title, check })),
    alerts,
    incident: incidentId ? { title: WORKFLOW_INCIDENTS[incidentId], steps: [...INCIDENT_STEPS[incidentId]] } : null,
  };
}

export function buildRfqDraft({ shipment = {}, details = {} } = {}) {
  const mode = modeFor(shipment, details);
  const { code, place, version } = termFor(shipment?.incoterm, details?.namedPlace);
  const from = text(details?.from) || text(shipment?.exportCountry) || '[origin and pickup location]';
  const to = text(details?.to) || text(shipment?.destination) || '[destination and delivery location]';
  const load = text(details?.load, 240) || '[piece count, gross weight and dimensions or CBM]';
  const commodity = text(shipment?.product) || '[commodity description]';
  const hs = text(shipment?.hs, 30) || '[HS code, if confirmed]';
  const deliveryTerm = code
    ? code + ' ' + (place || '[named place]') + ' / ' + (version ? 'Incoterms ' + version : '[contract version]')
    : '[Incoterm, named place and version]';

  return [
    'Subject: Request for a freight quote',
    '',
    'Hello,',
    '',
    'Could you provide a written quote for this shipment?',
    '',
    'From: ' + from,
    'To: ' + to,
    'Preferred mode: ' + (ENGLISH_MODES[mode] || '[please propose]'),
    'Commodity: ' + commodity,
    'HS code: ' + hs,
    'Shipment size: ' + load,
    'Delivery term: ' + deliveryTerm,
    'Cargo ready date and time zone: [please complete]',
    'Special handling: [please specify if applicable]',
    '',
    'Please confirm the pickup and delivery scope, route, handoff points, estimated transit time, and booking or delivery cutoffs with time zones.',
    'Please itemize freight, pickup and delivery, origin and destination handling, documentation, surcharges, and any optional brokerage or insurance. List duties and taxes separately if included.',
    'Please include the total and currency, quote validity, free time and storage or waiting charges, and any exclusions or assumptions.',
    'If you can offer more than one mode, please quote each option with the same scope for comparison.',
    '',
    'Thank you,',
    '[Name]',
  ].join('\n');
}

function uniqueMatch(question, catalog) {
  const matches = Object.keys(catalog).filter(id => catalog[id].test(question));
  return matches.length === 1 ? matches[0] : '';
}

export function inferWorkflowScenario(question, shipment = {}, details = {}) {
  const input = text(question, 2000);
  const terms = new Set([...input.matchAll(QUESTION_TERM)].map(([code]) => code.toUpperCase()));
  const code = terms.size === 1 ? [...terms][0] : '';
  const incident = uniqueMatch(input, QUESTION_INCIDENTS);
  const mode = uniqueMatch(input, QUESTION_MODES);
  if (!code && !incident && !(mode && QUESTION_OPERATION.test(input))) return null;

  const caseTerm = termFor(shipment?.incoterm, details?.namedPlace);
  const version = TERM_VERSION.exec(input)?.[1];
  const sameTerm = !code || code === caseTerm.code;
  const revisedTerm = code && (!sameTerm || (version && version !== caseTerm.version));
  return {
    shipment: revisedTerm ? { ...shipment, incoterm: version ? code + ' Incoterms ' + version : code } : shipment,
    details: {
      ...details,
      ...(mode && { mode }),
      ...(incident && { incident }),
      ...(!sameTerm && { namedPlace: '' }),
      ...(revisedTerm && sameTerm && caseTerm.place && { namedPlace: caseTerm.place }),
    },
  };
}
