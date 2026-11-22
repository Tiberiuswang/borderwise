import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildRfqDraft,
  buildShipmentWorkflow,
  inferWorkflowScenario,
  WORKFLOW_INCIDENTS,
  WORKFLOW_MODES,
  WORKFLOW_STAGES,
} from '../docs/shipment-workflow.js';

const TODAY = '2026-02-27';

function workflow(incoterm, details = {}, rest = {}) {
  return buildShipmentWorkflow({ shipment: { incoterm, ...rest }, details, today: TODAY });
}

test('every recognized mode supplies a full checklist and its own handoff and documents', () => {
  const generic = workflow('');
  assert.deepEqual(generic.milestones.map(item => item.id), Object.keys(WORKFLOW_STAGES));
  const outcomes = {
    ocean: [/进港/, /提单|海运单/],
    rail: [/进站/, /铁路运单/],
    air: [/航空运单/, /航空运单/],
    road: [/车号/, /公路运输单证/],
    multimodal: [/各段/, /分段运单/],
  };
  for (const mode of Object.keys(WORKFLOW_MODES)) {
    const actual = workflow('', { mode });
    assert.match(actual.milestones.find(item => item.id === 'handover').action, outcomes[mode][0]);
    assert.ok(actual.documents.some(document => outcomes[mode][1].test(document.title)));
    assert.ok(actual.documents.some(document => document.title === '商业发票'));
  }

  assert.deepEqual(workflow('', {}, { transport: '空运' }), workflow('', { mode: 'air' }));
  assert.deepEqual(workflow('', { mode: 'road' }, { transport: '空运' }), workflow('', { mode: 'road' }));
});

test('CIF and CIP distinguish prepaid carriage and insurance from early risk transfer', () => {
  const cif = workflow('CIF Rotterdam Incoterms® 2020', { mode: 'ocean' });
  assert.deepEqual(cif.term, { code: 'CIF', title: '成本、保险费加运费', place: 'Rotterdam', note: cif.term.note });
  assert.match(cif.responsibilities[0].detail, /指定目的港的运费/);
  assert.match(cif.responsibilities[1].detail, /装运港.*船上/);
  assert.match(cif.responsibilities[2].detail, /条款 \(C\)/);

  const cip = workflow('CIP Warsaw', { mode: 'rail', namedPlace: 'Warsaw Terminal 4' });
  assert.equal(cip.term.place, 'Warsaw Terminal 4');
  assert.match(cip.responsibilities[0].detail, /指定目的地.*保险费/);
  assert.match(cip.responsibilities[1].detail, /交承运人/);
  assert.match(cip.responsibilities[2].detail, /条款 \(A\)/);
});

test('FCA and delivered terms retain their different unloading and clearance obligations', () => {
  const fca = workflow('FCA Warehouse 1');
  assert.match(fca.responsibilities[1].detail, /卖方场地.*装上.*其他指定地点.*备妥卸货/);
  assert.match(fca.responsibilities[2].detail, /卖方办理出口.*买方办理进口/);
  assert.match(workflow('DAP Oslo').responsibilities[1].detail, /备妥卸货/);
  assert.match(workflow('DPU Oslo').responsibilities[1].detail, /卸下/);
  assert.match(workflow('DDP Oslo').responsibilities[2].detail, /卖方负责.*进口手续/);
});

test('legacy DDU and different or ambiguous contract versions get explicit handling', () => {
  const ddu = workflow('DDU Tokyo (Incoterms 2000)');
  assert.match(ddu.term.note, /Incoterms 2000.*Incoterms 2020 已无/);
  assert.equal(ddu.term.place, 'Tokyo');
  assert.match(ddu.responsibilities[0].detail, /进口手续及相关税费由买方承担/);
  assert.deepEqual(workflow('DDU Tokyo Incoterms 2010').responsibilities, []);
  assert.equal(workflow('FOB上海', { mode: 'ocean' }).term.place, '上海');
  assert.equal(workflow('FOB上海（Incoterms 2020）', { mode: 'ocean' }).term.place, '上海');
  assert.match(workflow('FCA Lyon Incoterms 2010').term.note, /2010/);
  assert.deepEqual(workflow('FCA Lyon Incoterms 2010').responsibilities, []);
  assert.equal(workflow('FOB/CIF').term.code, '');
  assert.deepEqual(workflow('FOB Shanghai / CIF Tokyo').responsibilities, []);
});

test('alerts use the recorded stage and validated dates rather than inferring progress', () => {
  const stage = 'booking';
  const overdue = workflow('', { stage, dueDate: '2026-02-26' }).alerts;
  assert.equal(overdue[0].level, 'high');
  assert.match(overdue[0].action, /订舱或订车.*2026-02-26/);
  assert.equal(workflow('', { stage, dueDate: TODAY }).alerts[0].title, '记录期限为今天');
  assert.equal(workflow('', { stage, dueDate: '2026-03-01' }).alerts[0].level, 'medium');
  assert.deepEqual(workflow('', { stage, dueDate: '2026-03-02' }).alerts, []);
  assert.deepEqual(workflow('', { stage: 'complete', dueDate: '2026-02-01' }).alerts, []);
  assert.deepEqual(workflow('', { stage }).alerts, []);
  assert.equal(workflow('', { stage, dueDate: '2026-02-29' }).alerts[0].level, 'info');
  assert.equal(workflow('', { dueDate: '2026-02-01' }).alerts[0].title, '当前节点期限待核对');
});

test('mode and named-place alerts prompt a review without asserting contract invalidity', () => {
  const actual = workflow('FOB', { mode: 'air' });
  assert.ok(actual.alerts.some(item => item.title === '核对贸易术语与交货方式' && item.level === 'medium'));
  assert.ok(actual.alerts.some(item => item.title === '尚缺合同指定地点'));
  assert.equal(workflow('FOB Shanghai', { mode: 'ocean' }).alerts.length, 0);
});

test('each exception returns a bounded playbook only when selected', () => {
  assert.equal(workflow('').incident, null);
  assert.equal(workflow('', { incident: '__proto__' }).incident, null);
  for (const [incident, title] of Object.entries(WORKFLOW_INCIDENTS)) {
    const result = workflow('', { incident }).incident;
    assert.equal(result.title, title);
    assert.equal(result.steps.length, 3);
  }
  assert.match(workflow('', { incident: 'customs_hold' }).incident.steps[2], /正式放行/);
  assert.match(workflow('', { incident: 'damage' }).incident.steps[0], /记录异常/);
  assert.match(workflow('', { incident: 'extra_charges' }).incident.steps[1], /合同.*免费期/);
});

test('RFQ draft uses entered commercial details, placeholders and comparable itemized costs', () => {
  const draft = buildRfqDraft({
    shipment: {
      product: 'Ceramic tiles',
      hs: '690721',
      incoterm: 'FCA Shanghai Incoterms 2020',
      consignee: 'Private Customer Name',
      notes: 'Internal margin details',
      value: '742373',
    },
    details: {
      mode: 'multimodal', from: 'Shanghai', to: 'Lyon', load: '4 pallets, 1,200 kg / 8 CBM', dueDate: '2026-02-27',
    },
  });
  assert.match(draft, /^Subject: Request for a freight quote/);
  assert.match(draft, /From: Shanghai\nTo: Lyon\nPreferred mode: Multimodal transport/);
  assert.match(draft, /Commodity: Ceramic tiles\nHS code: 690721\nShipment size: 4 pallets, 1,200 kg \/ 8 CBM/);
  assert.match(draft, /Delivery term: FCA Shanghai \/ Incoterms 2020/);
  assert.match(draft, /Cargo ready date and time zone: \[please complete\]/);
  assert.match(draft, /itemize freight.*origin and destination handling/);
  assert.match(draft, /each option with the same scope/);
  assert.doesNotMatch(draft, /Private Customer|Internal margin|742373|2026-02-27/);
});

test('RFQ draft bounds free text, flattens control characters and avoids assuming missing details', () => {
  const draft = buildRfqDraft({
    shipment: { exportCountry: 'China', destination: 'France', incoterm: 'FOB' },
    details: { mode: 'unknown', load: '5 crates\r\nBcc: ...\u202EM' + 'x'.repeat(500) },
  });
  assert.match(draft, /From: China\nTo: France\nPreferred mode: \[please propose\]/);
  assert.match(draft, /Shipment size: 5 crates Bcc: \.\.\. M/);
  assert.match(draft, /Delivery term: FOB \[named place\] \/ \[contract version\]/);
  assert.doesNotMatch(draft, /\nBcc:|\u202e/i);
  assert.ok(draft.split('\n').find(line => line.startsWith('Shipment size:')).length <= 255);
});

test('natural language scenarios resolve explicit operations without fabricating case details', () => {
  const ocean = inferWorkflowScenario('海运甩柜怎么办？');
  assert.deepEqual(ocean.details, { mode: 'ocean', incident: 'rolled' });
  assert.match(buildShipmentWorkflow(ocean).incident.steps[0], /承运人/);
  assert.match(buildShipmentWorkflow(ocean).incident.steps[0], /按时交付却未装船/);
  assert.equal(inferWorkflowScenario('目的港查验怎么办？').details.incident, 'customs_hold');
  assert.equal(inferWorkflowScenario('错过截港怎么办？').details.incident, 'missed_cutoff');
  assert.equal(inferWorkflowScenario('目的港拒收怎么办？').details.incident, 'delivery_refused');
  assert.equal(inferWorkflowScenario('这票被收取了滞箱费').details.incident, 'extra_charges');
  assert.equal(inferWorkflowScenario('发生货损应该怎么走？').details.incident, 'damage');
  assert.deepEqual(inferWorkflowScenario('空运要哪些单证？').details, { mode: 'air' });
  assert.equal(inferWorkflowScenario('目的国海关关税是多少？'), null);
  assert.equal(inferWorkflowScenario('海运和铁路哪个便宜？'), null);
  assert.equal(inferWorkflowScenario('FOB 和 CIF 有什么区别？'), null);

  const scenario = inferWorkflowScenario('合同如果改成DDU，怎么分工？', { incoterm: 'FCA Lyon', origin: 'China' }, { namedPlace: 'Lyon' });
  assert.deepEqual(scenario, { shipment: { incoterm: 'DDU', origin: 'China' }, details: { namedPlace: '' } });
  const priorVersion = inferWorkflowScenario('FOB Incoterms 2010 下的交货责任？', { incoterm: 'FOB Shanghai' });
  assert.equal(priorVersion.details.namedPlace, 'Shanghai');
  assert.deepEqual(buildShipmentWorkflow(priorVersion).responsibilities, []);
});
