export const SOURCES = Object.freeze([
  { id: 'wco', title: '世界海关组织：HS 协调制度简介', url: 'https://www.wcoomd.org/en/topics/nomenclature/overview/what-is-the-harmonized-system.aspx' },
  { id: 'origin', title: '世界海关组织：原产地规则概览（具体规则须另查适用法域）', url: 'https://www.wcoomd.org/en/topics/origin/overview.aspx' },
  { id: 'customs', title: '世界海关组织：海关程序与贸易便利化概览（具体要求须另查目的地）', url: 'https://www.wcoomd.org/en/topics/facilitation/overview.aspx' },
  { id: 'cbam', title: '欧盟委员会：CBAM 官方资料', url: 'https://taxation-customs.ec.europa.eu/carbon-border-adjustment-mechanism_en' },
  { id: 'rcep', title: 'RCEP 官方资料', url: 'https://rcepsec.org/' },
  { id: 'incoterms', title: '美国国际贸易署：Incoterms 介绍', url: 'https://www.trade.gov/know-your-incoterms' },
  { id: 'export', title: '英国政府出口流程（仅为示例，须另查适用地区）', url: 'https://www.gov.uk/export-goods' },
  { id: 'sanctions', title: '联合国安理会综合制裁名单（不是全部适用名单）', url: 'https://main.un.org/securitycouncil/en/content/un-sc-consolidated-list' },
]);

export const EXAMPLE_SHIPMENT = Object.freeze({
  product: '不锈钢紧固件（示例，具体规格待确认）',
  hs: '731815',
  origin: '中国',
  exportCountry: '中国',
  destination: '德国',
  value: '12000',
  currency: 'USD',
  incoterm: 'DAP Hamburg',
  consignee: '示例收货方（请替换为真实名称与地址）',
  material: '不锈钢',
  transport: '海运',
  documents: '商业发票、装箱单',
  notes: '仅作演示，不代表已完成分类或适用性判定。',
});

const FIELDS = ['product', 'hs', 'origin', 'exportCountry', 'destination', 'value', 'currency', 'incoterm', 'consignee', 'material', 'transport', 'documents', 'notes'];
const UNKNOWN = /^(?:未知|不详|不清楚|未填写|未提供|未确定|待确认|待定|暂无|无|没有|none|null|n\/?a|unknown|not\s+(?:known|provided)|-+)$/i;
const WARNING = '未知不等于安全，需人工核验。';
const BOUNDARY = '本地规则未接入实时海关、制裁名单、CBAM 数据或真实税率，也不进行 HS 归类；未知不等于安全，需人工核验，不能据此认定合规或保证通关。';
const QUESTION_TOPICS = {
  safety: /保证|一定|百分之百|是否安全|安全吗|是否合规|合规吗|能通关吗|保证通关|无风险|safe|compliant|guarantee/i,
  cbam: /cbam|碳关税|碳边境|碳排放/i,
  rcep: /rcep|自贸协定|优惠原产地|优惠关税/i,
  hs: /hs|编码|税号|归类|classification/i,
  origin: /原产地|产地|origin/i,
  sanctions: /制裁|禁运|名单|出口管制|sanction|embargo/i,
  duties: /税率|关税|税费|税金|进口税|费用|duty|tariff/i,
  documents: /发票|装箱单|单证|文件|材料|证明|清单|报关单|invoice|document/i,
  incoterm: /incoterm|贸易术语|fob|cif|ddp|dap|exw/i,
  transport: /运输|海运|空运|危险品|电池|物流|shipping|transport/i,
};
const GAP_REVIEW_IDS = new Set([
  'product-vague', 'hs-format', 'value-invalid', 'value-zero',
  'currency-format', 'incoterm-review', 'documents-incomplete',
]);

function scalar(value) {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'bigint') return String(value);
  return '';
}

function normalize(input) {
  const raw = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const clean = {};
  for (const key of FIELDS) {
    const value = raw[key];
    clean[key] = key === 'documents' && Array.isArray(value)
      ? value.map(scalar).filter(Boolean).join('、')
      : scalar(value);
  }
  return clean;
}

function provided(value) {
  return value !== '' && !UNKNOWN.test(value);
}


const EU = new Set([
  'eu', '欧盟', '欧洲联盟', 'european union',
  'at', '奥地利', 'austria', 'be', '比利时', 'belgium', 'bg', '保加利亚', 'bulgaria',
  'hr', '克罗地亚', 'croatia', 'cy', '塞浦路斯', 'cyprus', 'cz', '捷克', 'czechia', 'czech republic',
  'dk', '丹麦', 'denmark', 'ee', '爱沙尼亚', 'estonia', 'fi', '芬兰', 'finland',
  'fr', '法国', 'france', 'de', '德国', 'germany', 'gr', '希腊', 'greece',
  'hu', '匈牙利', 'hungary', 'ie', '爱尔兰', 'ireland', 'it', '意大利', 'italy',
  'lv', '拉脱维亚', 'latvia', 'lt', '立陶宛', 'lithuania', 'lu', '卢森堡', 'luxembourg',
  'mt', '马耳他', 'malta', 'nl', '荷兰', 'netherlands', 'pl', '波兰', 'poland',
  'pt', '葡萄牙', 'portugal', 'ro', '罗马尼亚', 'romania', 'sk', '斯洛伐克', 'slovakia',
  'si', '斯洛文尼亚', 'slovenia', 'es', '西班牙', 'spain', 'se', '瑞典', 'sweden',
]);
const RCEP = new Set([
  'cn', '中国', '中国大陆', 'china', 'jp', '日本', 'japan', 'kr', '韩国', 'south korea', 'republic of korea',
  'au', '澳大利亚', '澳洲', 'australia', 'nz', '新西兰', 'new zealand',
  'bn', '文莱', 'brunei', 'brunei darussalam', 'kh', '柬埔寨', 'cambodia',
  'id', '印度尼西亚', '印尼', 'indonesia', 'la', '老挝', 'laos', 'lao pdr',
  'my', '马来西亚', 'malaysia', 'mm', '缅甸', 'myanmar', 'ph', '菲律宾', 'philippines',
  'sg', '新加坡', 'singapore', 'th', '泰国', 'thailand', 'vn', '越南', 'vietnam', 'viet nam',
]);

function matchesCountry(value, aliases) {
  if (!provided(value)) return false;
  const lower = value.toLowerCase().trim();

  if (/(?:非|不是|不属于|不在|排除|以外|之外|除外|境外)|\b(?:not|non|outside|excluding|except|excluded)\b/i.test(lower)) return false;

  if (aliases.has('中国') && /(?:中国|\bchina\b|\bcn\b)/i.test(lower)
      && /(?:香港|澳门|台湾|\bhong\s*kong\b|\bmacau\b|\bmacao\b|\btaiwan\b)/i.test(lower)) return false;

  if ([lower, ...lower.split(/[,，/、;；()（）:：]/).map(part => part.trim())]
    .some(part => aliases.has(part))) return true;
  for (const alias of aliases) {
    if (/^[\u4e00-\u9fff]+$/.test(alias) && !['欧盟', '欧洲联盟'].includes(alias) && lower.startsWith(alias)) {
      const rest = lower.slice(alias.length).trimStart();

      if (rest && !/^(?:外|以东|以西|以南|以北|相关|无关|制造|生产|商品|产品|货物|进口|出口|原产)/.test(rest) && /^\p{L}/u.test(rest)) return true;
    }
    
    if (/^[a-z][a-z ]{2,}$/.test(alias) && lower.startsWith(`${alias} `)) {
      const rest = lower.slice(alias.length).trimStart();
      if (/^\p{L}/u.test(rest)) return true;
    }
  }
  return false;
}

function hsFormat(value) {
  if (!/^\d+(?:[.\s-]\d+)*$/.test(value)) return false;
  const digits = value.replace(/[.\s-]/g, '');
  return digits.length >= 6 && digits.length <= 12;
}

function amountStatus(value) {
  if (!provided(value)) return 'missing';
  if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(value)) return 'invalid';
  const amount = Number(value.replace(/,/g, ''));
  if (!Number.isFinite(amount)) return 'invalid';
  return amount === 0 ? 'zero' : 'valid';
}

function documentMentioned(text, pattern) {
  const negative = /未|无|没|缺|不具|待补|待提供|待准备|尚未|not\s+(?:provided|available|prepared)|missing|none/i;
  return text.split(/[,，;；\n]/).some(part => pattern.test(part) && !negative.test(part));
}

function asksEvasion(text) {
  const t = scalar(text).toLowerCase();
  const badAction = /规避|绕过|躲避|逃避|逃脱|避免|逃离|掩盖|隐瞒|伪造|造假|篡改|虚假|洗白|洗产地|改写|替换|变造|假冒|bypass|evad|circumvent|falsif|forge|fake/;
  const subject = /制裁|禁运|出口管制|管制|限制|原产地|产地|原产国|原产证明|名单|sanction|embargo|export control|origin/;
  return /洗产地|假产地|伪报原产地|伪造原产地|伪造产地|伪造证书|falsif(?:y|ying|ication)\s+(?:the\s+)?origin/.test(t)
    || (badAction.test(t) && subject.test(t));
}

function asksOfficialDocument(question) {
  return /(?:生成|制作|开具|出具|伪造|代写|generate|issue|create).{0,18}(?:报关单|原产地证|产地证|官方证书|正式证书|海关证明|customs declaration|certificate of origin)/i.test(question);
}

function asksShipmentGaps(question) {
  const shipment = /这批货|货物|货件|报关|申报|表单|资料|信息|字段/;
  const gaps = /(?:缺(?:少)?|差|补(?:充|齐)?)(?:了|些)?(?:哪些|哪几项|什么)|(?:哪些|哪几项|什么).{0,14}(?:没填|未填|缺失|待补|要补)|缺项|是否齐全|是否完整/;
  return shipment.test(question) && gaps.test(question);
}

function shipmentGaps(checks) {
  return checks.filter(({ id }) => id.endsWith('-missing') || GAP_REVIEW_IDS.has(id));
}

function describeShipmentGaps(input) {
  const { checks } = analyzeShipment(input);
  const gaps = shipmentGaps(checks);
  const extra = '请另行核实发货方、出口商和最终用户，并向报关专业人员确认实际所需的单证及许可。';
  if (!gaps.length) return `当前表单的常见资料项未发现明显缺项。请逐项核对真实单证、货物与交易信息的一致性。${extra}`;
  const ordered = [...gaps.filter(check => check.level === 'high'), ...gaps.filter(check => check.level !== 'high')];
  const items = ordered.map(({ title, action }) => `- ${title}：${action}`);
  return ['根据当前表单，可先补充或更正以下事项：', ...items, extra].join('\n');
}


export function analyzeShipment(input = {}) {
  const s = normalize(input);
  const checks = [];
  const add = (id, level, title, detail, action, sourceId = 'export') => {
    checks.push({ id, level, title, detail: `${detail} ${WARNING}`, action, sourceId });
  };

  add('limitations', 'info', '检查边界：不是合规结论',
    '本工具只运行本地规则，未接入实时海关、制裁名单、CBAM 数据或真实税率，也不进行 HS 归类。等级仅是资料复核优先级，不代表违法程度或通关概率。',
    '按实际交易地和日期查阅适用官方资料，并由报关专业人员核验。');

  if (!provided(s.product)) {
    add('product-missing', 'high', '缺少具体品名', '尚未提供可供核对的商品名称，无法判断应准备哪些商品资料。', '补充具体品名、型号、用途和规格；请人工确认申报名称。');
  } else if (/^(?:商品|货物|产品|配件|零件|样品|电子产品|goods|product|parts|sample)$/i.test(s.product)) {
    add('product-vague', 'medium', '品名过于笼统', '当前描述不足以区分具体商品或用途。', '补充品名、型号、用途、主要材质与技术参数。');
  } else {
    add('product-review', 'info', '复核商品描述', '已收到商品描述，但无法核实其真实性、规格或用途。', '逐项对照合同、发票和实物，补充型号、用途、规格及材质。');
  }
  if (!provided(s.material)) add('material-missing', 'medium', '缺少主要材质', '未提供材质或成分，商品核对和人工归类的信息可能不足。', '补充主要材质、成分比例及必要的技术资料。', 'wco');

  if (!provided(s.hs)) {
    add('hs-missing', 'high', '未提供 HS 编码', '缺少供复核的编码；本工具不会自动归类。', '提供拟申报编码，并请专业人员按实际商品及目的地规则复核。', 'wco');
  } else if (!hsFormat(s.hs)) {
    add('hs-format', 'high', 'HS 编码格式需复核', '此处仅接受去掉间隔符后为 6 至 12 位的数字；这只是本地输入格式检查，不是各国法定长度判断。', '核对数字、前导零和目的地所需位数；以文本形式填写，再请专业人员核对归类。', 'wco');
  } else {
    add('hs-review', 'info', 'HS 格式通过初筛，归类仍待核验', '输入看起来符合本工具的数字长度约定，但未查询编码是否存在，也没有核实商品归类。', '按实际规格和申报地税则，由报关专业人员复核编码与位数。', 'wco');
  }

  if (!provided(s.origin)) add('origin-missing', 'high', '未提供原产地', '原产地尚不清楚，不能根据出口地、发货地或运输路线推定。', '结合生产记录和适用规则核验真实原产地及所需证明。', 'origin');
  else add('origin-review', 'info', '原产地需依据生产事实核验', '输入的原产地仅为用户提供，未核实；出口地和原产地不一定相同。', '保留真实生产和采购记录，按适用规则核验原产地与证明，不得虚报。', 'origin');
  if (!provided(s.exportCountry)) add('export-country-missing', 'medium', '未提供出口地', '尚不清楚货物从哪里出口，无法明确应咨询哪个出口地主管机关。', '补充实际出口国家或地区，并核实对应出口手续。');
  if (!provided(s.destination)) add('destination-missing', 'high', '未提供目的地', '尚不清楚进口目的地，无法确定需要到哪里查询要求。', '补充进口目的国家或地区，以及必要的最终目的地。');

  const amount = amountStatus(s.value);
  if (amount === 'missing') add('value-missing', 'high', '未提供货值', '缺少可核对的交易金额，无法准备估价所需资料。', '填写不含币种符号的数字，并准备合同和发票；海关估价另行核验。');
  else if (amount === 'invalid') add('value-invalid', 'high', '货值格式无效', '金额不是可识别的非负数字；本工具不能推算税费。', '填写例如 12000 或 12,000.50 的数字；币种单独填写。');
  else if (amount === 'zero') add('value-zero', 'medium', '零货值需要说明', '输入金额为零；零价成交、样品或赠品的申报估价不能据此自动确定。', '说明交易性质，准备价值依据，并请专业人员按适用规则核验。');
  else add('value-review', 'info', '货值仍需核对', '输入金额是可识别的数字，但未核实实际交易价格或海关估价。', '核对合同、发票、付款及运保费资料；税费以主管机关规则为准。');
  if (!provided(s.currency)) add('currency-missing', 'medium', '未提供币种', '金额没有明确币种，无法有意义地核对。', '补充币种代码，并与合同、发票保持一致。');
  else if (!/^[a-z]{3}$/i.test(s.currency)) add('currency-format', 'medium', '币种格式需复核', '币种不是三位英文字母形式；本规则不核验代码或汇率。', '填写合同使用的币种代码，例如 USD，并人工核实。');

  if (!provided(s.incoterm)) add('incoterm-missing', 'medium', '未提供贸易术语', '尚未说明约定的交付责任，相关费用与手续分工可能不清楚。', '核对合同约定的术语、版本和具体地点，确认双方分工。', 'incoterms');
  else {
    const term = s.incoterm.toUpperCase().match(/^([A-Z]{3})(?:\b|$)/)?.[1];
    if (!['EXW', 'FCA', 'CPT', 'CIP', 'DAP', 'DPU', 'DDP', 'FAS', 'FOB', 'CFR', 'CIF'].includes(term)) {
      add('incoterm-review', 'medium', '贸易术语待核对', '输入未匹配本工具列出的常见 Incoterms 2020 三字母缩写；不表示合同无效。', '按合同核对术语、适用版本、指定地点与责任分工。', 'incoterms');
    } else {
      add('incoterm-details', 'info', '核对贸易术语和交付地点', '输入的缩写不证明合同责任已经落实，且不能据此推算税费。', '核对合同版本、指定地点及运输、保险和报关分工。', 'incoterms');
    }
  }
  if (!provided(s.transport)) add('transport-missing', 'medium', '运输方式未填写', '缺少运输方式，尚不能核对承运人可能要求的资料。', '补充海运、空运、陆运或其他方式，向承运人核实要求。');
  if (!provided(s.consignee)) add('consignee-missing', 'high', '未提供收货方', '缺少收货方信息，无法核对进口主体及相关交易方。', '补充收货方真实名称、地址及联系方式，并核验最终用户和其他交易方。', 'sanctions');
  else add('counterparty-review', 'medium', '交易方与最终用途待筛查', '收货方名称仅由用户提供，未核实身份；本工具未筛查任何制裁或出口管制名单。', '人工核验收发货方、最终用户、用途及适用名单；联合国名单不是全部可能适用的名单。', 'sanctions');
  add('shipper-review', 'medium', '发货方信息需另行补充', '当前表单未单列发货方或出口商，不能仅凭出口地确认交易主体。', '向实际交易方核实发货方、出口商和最终用户的真实身份及地址。', 'sanctions');

  if (!provided(s.documents) || /^(?:未准备|无单证|没有文件|没有单证|未准备文件|尚未准备)$/i.test(s.documents)) {
    add('documents-missing', 'high', '单证信息缺失', '未看到可供核对的文件清单；不代表实际文件一定不存在。', '列出已准备的合同、商业发票、装箱单及可能需要的许可或证明，并逐份核验。');
  } else {
    const invoice = documentMentioned(s.documents, /发票|invoice/i);
    const packing = documentMentioned(s.documents, /装箱单|箱单|packing\s*(?:list|slip)/i);
    if (!invoice || !packing) {
      const absent = [!invoice && '商业发票', !packing && '装箱单'].filter(Boolean).join('、');
      add('documents-incomplete', 'medium', '单证清单有待补充', `所填清单中未明确提到${absent}；是否需要应由具体业务及适用要求决定。`, `核对现有文件，确认是否需要补充${absent}，并询问报关行是否需要其他材料。`);
    } else add('documents-review', 'info', '单证内容与一致性待核验', '清单中提到发票和装箱单，但本工具未查看文件，也未确定其他必需材料。', '逐份核对名称、数量、金额、币种、交易方和产地；咨询实际需要的许可或证明。');
  }

  const destinationIsEU = matchesCountry(s.destination, EU);
  const destinationIsRCEP = matchesCountry(s.destination, RCEP);
  if (destinationIsEU) {
    add('cbam-review', 'medium', '欧盟目的地：CBAM 可能需要判定', '目的地名称被本地规则识别为欧盟或成员国；仅凭此信息、品名或 HS 不能判断 CBAM 是否适用或产生义务。', '由进口方结合实际进口地点、商品编码、数量、原产地和现行官方规则核对适用性；需要时向主管机关咨询。', 'cbam');
  }
  if (s.destination && !destinationIsEU && !destinationIsRCEP) {
    add('destination-generic-review', 'medium', '目的地要求需人工核验', '所填目的地未被本地规则识别为欧盟或 RCEP 国家；这不表示该地没有相关要求，也不是安全或合规判断。', '补充或确认实际目的地，向当地海关及相关主管机关核实进口手续、商品要求、税费、原产地和运输条件等。', 'customs');
  }
  if ((destinationIsRCEP && (matchesCountry(s.exportCountry, RCEP) || matchesCountry(s.origin, RCEP))) || /rcep/i.test(s.notes)) {
    add('rcep-review', 'medium', 'RCEP 优惠资格可能需要判定', '输入的交易地或备注提示可能涉及 RCEP；本规则未核实协定适用、货物原产资格或优惠待遇。', '核对相关交易方、协定生效情况、具体商品原产地规则、运输条件及证明要求，必要时咨询主管机关。', 'rcep');
  }
  if (/电池|锂电|易燃|化学品|化工|危险品|液体|粉末|磁性|军用|两用|武器|药品|医疗器械|battery|lithium|chemical|flammable|dual[ -]?use/i.test(`${s.product} ${s.material} ${s.notes}`)) {
    add('goods-review', 'high', '商品关键词提示需额外核验', '品名、材质或备注中出现可能与运输安全、许可或出口管制有关的词语；关键词不是监管分类或违法判断。', '提供技术规格及最终用途，由承运人和相关主管机关核实运输条件、许可及适用管制。');
  }
  if (asksEvasion(s.notes)) {
    add('evasion-warning', 'high', '拒绝虚报或规避管制', '备注中存在疑似规避管制或虚报原产地的表述；本工具不会提供此类操作方案。', '如实记录实际生产和运输情况，暂停可疑交易并咨询适用主管机关或专业人士。', 'sanctions');
  }

  return { checks, generatedAt: new Date().toISOString(), input: s };
}


export function getLocalFollowUps(question, input = {}) {
  const q = scalar(question).toLowerCase();
  if (!q || asksEvasion(q) || asksOfficialDocument(q)) return [];

  const { checks, input: shipment } = analyzeShipment(input);
  const ids = new Set(checks.map(check => check.id));
  const asked = new Set(Object.keys(QUESTION_TOPICS).filter(topic => QUESTION_TOPICS[topic].test(q)));
  if (asksShipmentGaps(q)) asked.add('gaps');
  const hasShipment = Object.values(shipment).some(provided);
  const hasGaps = shipmentGaps(checks).length > 0;
  const questions = [];
  const suggest = (topic, text, relevant) => {
    if (relevant && !asked.has(topic)) questions.push(text);
  };

  suggest('gaps', '这批货还缺哪些报关资料？', hasGaps && (hasShipment || asked.size > 0));
  suggest('transport', '需要向承运人核实哪些运输条件？', ids.has('goods-review'));
  suggest('cbam', '如何核对 CBAM 的适用范围？', ids.has('cbam-review'));
  suggest('rcep', 'RCEP 优惠资格要核对哪些条件？', ids.has('rcep-review'));
  suggest('hs', provided(shipment.hs) ? '如何核验已填写的 HS 编码？' : '没有 HS 编码时，如何准备归类信息？',
    provided(shipment.product) || provided(shipment.hs) || asked.has('cbam') || asked.has('documents') || asked.has('gaps'));
  suggest('origin', '应如何准备原产地核验依据？',
    provided(shipment.origin) || provided(shipment.exportCountry) || asked.has('hs') || asked.has('rcep') || asked.has('gaps'));
  suggest('documents', ids.has('documents-review') ? '如何核对单证与实物是否一致？' : '报关单证清单应列出哪些常见文件？',
    hasShipment || asked.has('gaps') || asked.has('transport') || asked.has('incoterm') || asked.has('hs'));
  suggest('sanctions', '怎样核验交易方和适用的制裁名单？',
    provided(shipment.consignee) || asked.has('origin') || asked.has('transport'));
  suggest('incoterm', '如何核对贸易术语和交付责任？',
    provided(shipment.incoterm) || asked.has('transport') || asked.has('duties'));
  suggest('duties', '查询税费前要核对哪些信息？',
    provided(shipment.destination) && (provided(shipment.value) || asked.has('hs') || asked.has('incoterm')));

  return questions.slice(0, 3);
}


export function localAnswer(question, input = {}, { workflowAnswer } = {}) {
  const q = scalar(question).toLowerCase();
  const s = normalize(input);
  
  if (asksEvasion(q)) {
    return `不能帮助通过转运、隐瞒交易方或虚报原产地来规避制裁或出口管制。请如实记录生产和运输事实，暂停可疑交易，并向适用主管机关或专业人士核实。\n\n${BOUNDARY}`;
  }
  if (asksOfficialDocument(q)) {
    return `不能生成或冒充正式报关单、官方证书或原产地证明。可先整理真实交易和生产记录，再由有权主体按适用流程提交或申请。\n\n${BOUNDARY}`;
  }

  const answers = [];
  const operations = workflowAnswer?.();
  const asksGaps = asksShipmentGaps(q);
  if (QUESTION_TOPICS.safety.test(q)) {
    answers.push('不能保证通关，也不能仅凭本地检查认定安全或合规。请先补齐商品、交易方、原产地和文件信息，再向报关专业人士与适用主管机关核验。');
  }
  if (asksGaps) answers.push(describeShipmentGaps(s));
  if (QUESTION_TOPICS.cbam.test(q)) {
    const hint = matchesCountry(s.destination, EU) ? '当前目的地名称被初步识别为欧盟或成员国。' : provided(s.destination) ? '当前目的地未被本地规则识别为欧盟；这不能排除其他地点或其他要求。' : '目的地尚未提供。';
    answers.push(`${hint}仅凭目的地、品名或 HS 不能判定 CBAM 是否适用。请与进口方核对实际进口地点、商品编码、数量、原产地及现行欧盟官方规则。`);
  }
  if (QUESTION_TOPICS.rcep.test(q)) {
    answers.push('RCEP 或其他协定优惠是否适用需要逐案判定，不能根据出口地或一张证书直接认定。请核对有关国家或地区、协定生效、具体商品原产地规则、运输条件和证明要求，再向主管机关咨询。');
  }
  if (QUESTION_TOPICS.hs.test(q)) {
    const hint = provided(s.hs) ? `已填写编码：${s.hs}；本工具只检查输入格式，不确认编码存在或分类正确。` : '尚未填写 HS 编码；本工具不自动归类。';
    answers.push(`${hint}请整理品名、用途、规格和材质，请专业人员按申报地当前税则核验。`);
  }
  if (QUESTION_TOPICS.origin.test(q)) {
    const hint = provided(s.origin) ? `表单所填原产地为“${s.origin}”，未经核实。` : '原产地尚未填写，不能按出口地推定。';
    answers.push(`${hint}请保存真实的生产及采购记录，按适用规则确认原产资格与证明，不能通过改变运输路线或文件来虚报产地。`);
  }
  if (QUESTION_TOPICS.sanctions.test(q)) {
    answers.push('本工具没有联网筛查制裁或出口管制名单，不能判断交易方是否受限。请核实收发货方、最终用户和用途，并人工查阅适用法域的官方清单及相关措施；联合国名单并非全部适用名单。');
  }
  if (QUESTION_TOPICS.duties.test(q)) {
    answers.push('本工具不提供实时税率、汇率或税费计算。请先核验目的地、商品编码、原产地、货值和贸易术语，再向目的地海关或专业报关人员查询适用税费与估价规则。');
  }
  if (!operations && !asksGaps && QUESTION_TOPICS.documents.test(q)) {
    const hint = provided(s.documents) ? `表单已填写单证清单，但未核实实际文件：${s.documents}。` : '表单尚未列出可核对的单证。';
    answers.push(`${hint}可先准备真实合同、商业发票和装箱资料，核对交易方、品名、数量、金额和产地，再确认实际所需许可或证明；这里只提供待办，不出具正式文件。`);
  }
  if (!operations && QUESTION_TOPICS.incoterm.test(q)) {
    const hint = provided(s.incoterm) ? `表单填写的贸易术语为“${s.incoterm}”。` : '表单尚未填写贸易术语。';
    answers.push(`${hint}请核对合同采用的术语版本和指定地点，并与交易方确认运输、保险、费用及报关分工。`);
  }
  if (QUESTION_TOPICS.transport.test(q)) {
    answers.push('请根据实际运输方式、商品规格及包装情况向承运人确认运输条件、所需检测和单证。涉及电池或化学品时，尤其需要提供真实技术资料；关键词本身不能判定危险品分类。');
  }
  if (operations) answers.push(operations);
  if (!answers.length) {
    const result = analyzeShipment(s);
    const priority = result.checks.filter(item => item.level === 'high').slice(0, 3);
    answers.push(priority.length
      ? `可先处理这些待办：${priority.map(item => `${item.title}（${item.action}）`).join('；')}。再核对交易方、实际用途与适用规则。`
      : '当前资料仍需核对商品归类、交易方、原产地及文件一致性，并按实际目的地确认许可、税费和运输要求。');
  }
  return `${answers.join('\n\n')}\n\n${BOUNDARY}`;
}
