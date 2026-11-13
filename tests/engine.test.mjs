import test from 'node:test';
import assert from 'node:assert/strict';
import { EXAMPLE_SHIPMENT, SOURCES, analyzeShipment, localAnswer } from '../docs/engine.js';

const fields = ['product', 'hs', 'origin', 'exportCountry', 'destination', 'value', 'currency', 'incoterm', 'consignee', 'material', 'transport', 'documents', 'notes'];
const standard = {
  product: '棉质衬衫，成人款',
  hs: '620520',
  origin: '中国',
  exportCountry: '中国',
  destination: '加拿大',
  value: '12,000.50',
  currency: 'USD',
  incoterm: 'FOB 上海港',
  consignee: 'Test Buyer, Toronto',
  material: '棉',
  transport: '海运',
  documents: '商业发票、装箱单',
  notes: '',
};
const ids = report => new Set(report.checks.map(check => check.id));
const check = (report, id) => report.checks.find(item => item.id === id);

function assertBoundaries(text) {
  assert.match(text, /未知不等于安全/);
  assert.match(text, /人工核验/);
  assert.doesNotMatch(text, /已合规|绝对安全|保证一定通关|完全不存在风险/);
}

test('输出结构稳定，信息来源均可解析，时间为 ISO 格式', () => {
  const report = analyzeShipment(EXAMPLE_SHIPMENT);
  assert.deepEqual(Object.keys(report), ['checks', 'generatedAt', 'input']);
  assert.deepEqual(Object.keys(report.input), fields);
  assert.ok(!Number.isNaN(Date.parse(report.generatedAt)));
  assert.match(report.generatedAt, /Z$/);
  assert.ok(report.checks.length > 0);
  assert.equal(new Set(report.checks.map(x => x.id)).size, report.checks.length);
  const sourceIds = new Set(SOURCES.map(s => s.id));
  assert.equal(sourceIds.size, SOURCES.length);
  assert.ok(SOURCES.length >= 4);
  for (const source of SOURCES) {
    assert.ok(source.title);
    assert.equal(new URL(source.url).protocol, 'https:');
  }
  for (const item of report.checks) {
    assert.deepEqual(Object.keys(item), ['id', 'level', 'title', 'detail', 'action', 'sourceId']);
    assert.ok(['high', 'medium', 'info'].includes(item.level));
    assert.ok(item.id && item.title && item.detail && item.action);
    assert.ok(sourceIds.has(item.sourceId), item.sourceId);
    assertBoundaries(item.detail);
  }
});

test('空对象和非对象输入都安全处理并明确多项缺项', () => {
  for (const input of [undefined, null, '', false, 1, [], {}]) {
    const report = analyzeShipment(input);
    assert.deepEqual(Object.keys(report.input), fields);
    for (const key of fields) assert.equal(report.input[key], '');
    for (const id of ['product-missing', 'hs-missing', 'origin-missing', 'destination-missing', 'value-missing', 'consignee-missing', 'documents-missing']) {
      assert.equal(check(report, id).level, 'high', id);
    }
    assertBoundaries(check(report, 'limitations').detail);
  }
});

test('仅接受定义字段，输入不被改变，数值货值和文件数组可使用', () => {
  const input = { ...standard, value: 1200.5, documents: ['商业发票', '装箱单'], unknown: 'ignore' };
  const snapshot = structuredClone(input);
  const report = analyzeShipment(input);
  assert.deepEqual(input, snapshot);
  assert.equal(report.input.value, '1200.5');
  assert.equal(report.input.documents, '商业发票、装箱单');
  assert.equal('unknown' in report.input, false);
  assert.ok(ids(report).has('documents-review'));
  assert.ok(ids(report).has('value-review'));
  report.input.product = 'changed';
  assert.equal(input.product, '棉质衬衫，成人款');
});

test('未知、对象和空格不是有效字段', () => {
  const report = analyzeShipment({ ...standard, product: '  ', origin: '未知', consignee: {}, hs: 'N/A', documents: [] });
  for (const id of ['product-missing', 'origin-missing', 'consignee-missing', 'hs-missing', 'documents-missing']) {
    assert.ok(ids(report).has(id), id);
  }
});

test('笼统品名与具体品名产生不同待办', () => {
  const vague = analyzeShipment({ ...standard, product: '配件', material: '' });
  const detailed = analyzeShipment(standard);
  assert.ok(ids(vague).has('product-vague'));
  assert.ok(ids(vague).has('material-missing'));
  assert.ok(ids(detailed).has('product-review'));
  assert.ok(!ids(detailed).has('product-vague'));
});

test('HS 只检查约定格式，长度合格也不声称编码或归类有效', () => {
  for (const hs of ['123456', '1234.56.78', '123456789012', '1234 56']) {
    const report = analyzeShipment({ ...standard, hs });
    assert.ok(ids(report).has('hs-review'), hs);
    assert.match(check(report, 'hs-review').detail, /未查询编码是否存在|没有核实/);
  }
  for (const hs of ['12', '1234567890123', '12ab56', '1234..56', '-123456', '123456.']) {
    assert.equal(check(analyzeShipment({ ...standard, hs }), 'hs-format').level, 'high', hs);
  }
  assert.ok(ids(analyzeShipment({ ...standard, hs: '' })).has('hs-missing'));
});

test('货值接受有限正数，拒绝负数、文字、指数、错误千分位和无穷大', () => {
  for (const value of ['1234', '1234.56', '1,234.56', 10, '0.001']) {
    assert.ok(ids(analyzeShipment({ ...standard, value })).has('value-review'), String(value));
  }
  for (const value of ['-1', '1e3', 'USD 100', '12,34', '12.3.4', 'Infinity', NaN, Infinity, '9'.repeat(400)]) {
    assert.ok(ids(analyzeShipment({ ...standard, value })).has('value-invalid'), String(value));
  }
  assert.ok(ids(analyzeShipment({ ...standard, value: '' })).has('value-missing'));
  assert.ok(ids(analyzeShipment({ ...standard, value: '0.00' })).has('value-zero'));
});

test('币种格式检查不声称查询了有效币种与汇率', () => {
  assert.ok(ids(analyzeShipment({ ...standard, currency: '' })).has('currency-missing'));
  const report = analyzeShipment({ ...standard, currency: '美元' });
  assert.ok(ids(report).has('currency-format'));
  assert.match(check(report, 'currency-format').detail, /不核验/);
  assert.ok(!ids(analyzeShipment({ ...standard, currency: 'usd' })).has('currency-format'));
});

test('文件清单为文本或数组，明确区分缺失、未提及及待核验', () => {
  assert.ok(ids(analyzeShipment({ ...standard, documents: '未准备' })).has('documents-missing'));
  const missingPacking = analyzeShipment({ ...standard, documents: '商业发票' });
  assert.match(check(missingPacking, 'documents-incomplete').detail, /装箱单/);
  const negative = analyzeShipment({ ...standard, documents: '无发票、装箱单' });
  assert.match(check(negative, 'documents-incomplete').detail, /商业发票、装箱单/);
  const mixed = analyzeShipment({ ...standard, documents: '发票已提供，箱单未准备' });
  assert.match(check(mixed, 'documents-incomplete').detail, /装箱单/);
  const present = analyzeShipment({ ...standard, documents: ['commercial invoice', 'packing list'] });
  assert.match(check(present, 'documents-review').detail, /未查看文件/);
});

test('即使没有输入明显缺项，也保留交易方及发货方人工核验', () => {
  const report = analyzeShipment(standard);
  assert.ok(!report.checks.some(x => x.level === 'high'));
  assert.ok(ids(report).has('counterparty-review'));
  assert.ok(ids(report).has('shipper-review'));
  assert.match(check(report, 'counterparty-review').detail, /未筛查/);
  assertBoundaries(check(report, 'limitations').detail);
});

test('商品关键词只提示可能核验，不认定违法或自动分类', () => {
  const normal = analyzeShipment(standard);
  const battery = analyzeShipment({ ...standard, product: '含锂电池的便携设备' });
  assert.ok(!ids(normal).has('goods-review'));
  assert.equal(check(battery, 'goods-review').level, 'high');
  assert.match(check(battery, 'goods-review').detail, /不是监管分类或违法判断/);
});

test('欧盟目的地提示可能需判定 CBAM，不断言适用或计算', () => {
  for (const destination of ['欧盟', 'EU', '德国', 'DE', 'France', '波兰', '德国，汉堡', '德国汉堡', '德国 Hamburg', 'Germany Hamburg', 'Hamburg, Germany', '德国不来梅']) {
    const report = analyzeShipment({ ...standard, destination });
    const item = check(report, 'cbam-review');
    assert.ok(item, destination);
    assert.match(item.detail, /不能判断/);
    assert.equal(item.sourceId, 'cbam');
    assert.ok(!ids(report).has('destination-generic-review'), destination);
  }
});

test('非欧盟及模糊目的地不产生欧盟目的地的肯定识别', () => {
  for (const destination of ['美国', 'US', '英国', '加拿大', '澳大利亚', 'Australia', '非欧盟', 'not EU', 'non-EU', '欧盟以外', '德国以外', '德国外', '德国以东', 'not Germany', '德国制造', '德国相关货物', 'DE Hamburg', '']) {
    assert.ok(!ids(analyzeShipment({ ...standard, destination })).has('cbam-review'), destination);
  }
});

test('未识别为欧盟或 RCEP 的非空目的地有明确通用人工核验项', () => {
  for (const destination of ['美国', '加拿大', '非欧盟', 'not EU', '未知', '德国以外']) {
    const item = check(analyzeShipment({ ...standard, destination }), 'destination-generic-review');
    assert.ok(item, destination);
    assert.equal(item.level, 'medium');
    assert.match(item.detail, /不表示该地没有相关要求/);
    assert.match(item.action, /当地海关.*主管机关/);
    assertBoundaries(item.detail);
    assert.equal(item.sourceId, 'customs');
  }
  assert.ok(ids(analyzeShipment({ ...standard, destination: '未知' })).has('destination-missing'));
  assert.ok(!ids(analyzeShipment({ ...standard, destination: '' })).has('destination-generic-review'));
  const rcepDestination = analyzeShipment({ ...standard, destination: '日本东京', origin: '美国', exportCountry: '美国' });
  assert.ok(!ids(rcepDestination).has('destination-generic-review'));
  assert.ok(!ids(rcepDestination).has('rcep-review'));
});

test('中国与独立海关辖区的混合地址不自动识别为 RCEP 目的地', () => {
  for (const destination of ['中国香港', '中国，澳门', '中国台湾', 'China Hong Kong', 'Hong Kong, China', 'Taiwan, China']) {
    const report = analyzeShipment({ ...standard, destination });
    assert.ok(!ids(report).has('rcep-review'), destination);
    assert.ok(ids(report).has('destination-generic-review'), destination);
  }
  assert.ok(ids(analyzeShipment({ ...standard, destination: '中国大陆上海' })).has('rcep-review'));
});

test('RCEP 只做可能性提醒，不确定优惠资格或税率', () => {
  for (const destination of ['日本', 'JP', '新加坡', 'Australia', '日本东京', '日本 Tokyo', 'Australia Sydney', 'South Korea Seoul']) {
    const item = check(analyzeShipment({ ...standard, destination }), 'rcep-review');
    assert.ok(item, destination);
    assert.match(item.detail, /未核实/);
    assert.match(item.action, /核对/);
    assert.equal(item.sourceId, 'rcep');
  }
  assert.ok(!ids(analyzeShipment({ ...standard, destination: '德国' })).has('rcep-review'));
  assert.ok(ids(analyzeShipment({ ...standard, notes: '客户询问 RCEP' })).has('rcep-review'));
  assert.ok(ids(analyzeShipment({ ...standard, destination: '日本东京', origin: '中国上海', exportCountry: '美国' })).has('rcep-review'));
});

test('不依据出口地自动推定原产地，也不把两者不同认定违法', () => {
  const report = analyzeShipment({ ...standard, origin: '', exportCountry: '日本' });
  assert.match(check(report, 'origin-missing').detail, /不能根据出口地/);
  const different = analyzeShipment({ ...standard, origin: '中国', exportCountry: '日本' });
  assert.match(check(different, 'origin-review').detail, /不一定相同/);
  assert.doesNotMatch(check(different, 'origin-review').detail, /涉嫌违法|必然违法/);
});

test('原产地的一般待办使用中性官方来源，仅 RCEP 专项使用 RCEP 来源', () => {
  const source = SOURCES.find(item => item.id === 'origin');
  assert.equal(source.url, 'https://www.wcoomd.org/en/topics/origin/overview.aspx');
  assert.match(source.title, /具体规则须另查适用法域/);
  for (const origin of ['', '中国']) {
    const report = analyzeShipment({ ...standard, origin, destination: '德国' });
    const item = check(report, origin ? 'origin-review' : 'origin-missing');
    assert.equal(item.sourceId, 'origin');
    assert.ok(!ids(report).has('rcep-review'));
    assert.ok(!report.checks.some(entry => entry.sourceId === 'rcep'));
  }
  const rcep = analyzeShipment({ ...standard, destination: '日本' });
  assert.deepEqual(rcep.checks.filter(item => item.sourceId === 'rcep').map(item => item.id), ['rcep-review']);
});

test('当地术语异常也只提示核对，不作合同无效判断', () => {
  const report = analyzeShipment({ ...standard, incoterm: 'DAT Rotterdam' });
  assert.match(check(report, 'incoterm-review').detail, /不表示合同无效/);
  assert.ok(ids(analyzeShipment({ ...standard, incoterm: '' })).has('incoterm-missing'));
});

test('备注中试图虚报或规避的内容引发拒绝与真实记录提醒', () => {
  for (const notes of ['转运绕过制裁', '伪造原产地', '洗产地', 'bypass sanctions']) {
    const item = check(analyzeShipment({ ...standard, notes }), 'evasion-warning');
    assert.ok(item, notes);
    assert.match(item.detail, /不会提供/);
    assert.match(item.action, /如实/);
  }
});

test('本地问答分类且根据表单变化，不伪装实时查询', () => {
  const a = localAnswer('HS 编码应该怎么核验？', { ...standard, hs: '620520' });
  const b = localAnswer('HS 编码应该怎么核验？', { ...standard, hs: '' });
  assert.notEqual(a, b);
  assert.match(a, /620520/);
  assert.match(b, /尚未填写/);
  assert.match(a, /只检查输入格式/);
  assertBoundaries(a);
  assertBoundaries(b);
  const eu = localAnswer('CBAM 如何判断', { ...standard, destination: '德国' });
  const us = localAnswer('CBAM 如何判断', { ...standard, destination: '美国' });
  assert.notEqual(eu, us);
  assert.match(eu, /不能判定/);
  assert.match(us, /不能排除/);
});

test('普通多主题问题分别回答，重复关键词不会重复主题，边界只在末尾出现', () => {
  const hsCbam = localAnswer('HS 编码、税号与 CBAM 碳边境要怎么核验？', { ...standard, destination: '德国汉堡' });
  assert.match(hsCbam, /当前目的地名称被初步识别为欧盟或成员国/);
  assert.match(hsCbam, /不能判定 CBAM 是否适用/);
  assert.match(hsCbam, /已填写编码：620520/);
  assert.equal((hsCbam.match(/已填写编码：620520/g) || []).length, 1);
  assert.equal((hsCbam.match(/不能判定 CBAM 是否适用/g) || []).length, 1);

  const combined = localAnswer('原产地、制裁名单与潜在物流风险怎么核验？', standard);
  for (const phrase of ['表单所填原产地', '没有联网筛查制裁或出口管制名单', '向承运人确认运输条件']) {
    assert.equal(combined.split(phrase).length - 1, 1, phrase);
  }
  for (const answer of [hsCbam, combined]) {
    assertBoundaries(answer);
    assert.equal((answer.match(/本地规则未接入实时/g) || []).length, 1);
    assert.equal((answer.match(/未知不等于安全/g) || []).length, 1);
    assert.match(answer, /未知不等于安全，需人工核验，不能据此认定合规或保证通关。$/);
  }
});

test('多个普通主题均可并列回答，安全保证拒绝放在最前', () => {
  const answer = localAnswer('是否安全？HS 编码、CBAM、RCEP、原产地、制裁名单、关税、发票、贸易术语和物流如何核验？', standard);
  assert.ok(answer.startsWith('不能保证通关'));
  for (const phrase of ['不能判定 CBAM 是否适用', 'RCEP 或其他协定优惠', '已填写编码：620520', '表单所填原产地', '没有联网筛查制裁或出口管制名单', '不提供实时税率', '表单已填写单证清单', '表单填写的贸易术语', '向承运人确认运输条件']) {
    assert.equal(answer.split(phrase).length - 1, 1, phrase);
  }
  assert.equal((answer.match(/本地规则未接入实时/g) || []).length, 1);
  assertBoundaries(answer);
});

test('规避与伪造正式单证请求优先拒绝，不被其他主题覆盖', () => {
  const evasion = localAnswer('如何绕过制裁，另外请问 HS 编码与 CBAM？', standard);
  assert.ok(evasion.startsWith('不能帮助'));
  assert.doesNotMatch(evasion, /已填写编码：620520|不能判定 CBAM 是否适用/);
  const forgery = localAnswer('请生成原产地证，同时查询 HS 编码与 CBAM', standard);
  assert.ok(forgery.startsWith('不能生成或冒充正式'));
  assert.doesNotMatch(forgery, /已填写编码：620520|不能判定 CBAM 是否适用/);
  for (const answer of [evasion, forgery]) {
    assert.equal((answer.match(/本地规则未接入实时/g) || []).length, 1);
    assertBoundaries(answer);
  }
});

test('常见问题答案均为纯文本、差异化且自带边界', () => {
  const questions = ['原产地怎么核验', 'RCEP 优惠怎么申请', '货物有哪些制裁风险', '关税怎么算', '需要哪些单证', 'FOB 是什么', '电池如何运输', '还有哪些问题'];
  const answers = questions.map(q => localAnswer(q, standard));
  assert.ok(new Set(answers).size === answers.length);
  for (const answer of answers) {
    assert.equal(typeof answer, 'string');
    assert.ok(answer.length > 30);
    assertBoundaries(answer);
    assert.match(answer, /未接入实时/);
    assert.doesNotMatch(answer, /<html|<script/i);
  }
  assert.match(answers[3], /不提供实时税率/);
  assert.match(answers[4], /不出具正式文件/);
});

test('拒绝保证安全、合规或通关', () => {
  for (const question of ['这批货安全吗？', '已经合规吗？', '你能保证通关吗？', 'is it compliant?']) {
    const answer = localAnswer(question, standard);
    assert.match(answer, /不能保证通关/);
    assert.match(answer, /不能.*认定安全或合规/);
    assertBoundaries(answer);
  }
});

test('拒绝规避制裁及伪造原产地，不提供操作方案', () => {
  for (const question of ['如何通过第三国转运绕过制裁？', '怎么伪造原产地证？', '有什么方法洗产地？', 'How to bypass sanctions?']) {
    const answer = localAnswer(question, standard);
    assert.match(answer, /不能帮助/);
    assert.match(answer, /如实记录/);
    assertBoundaries(answer);
  }
});

test('不生成可冒充官方文件的报关单或原产地证', () => {
  for (const question of ['请生成报关单', '帮我开具原产地证', 'generate a certificate of origin']) {
    const answer = localAnswer(question, standard);
    assert.match(answer, /不能生成或冒充正式/);
    assertBoundaries(answer);
  }
});

test('异常问题及异常表单不会报错', () => {
  for (const q of [null, undefined, {}, [], 0]) {
    const answer = localAnswer(q, null);
    assert.equal(typeof answer, 'string');
    assertBoundaries(answer);
  }
});
