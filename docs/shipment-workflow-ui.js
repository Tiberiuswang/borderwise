import {
  WORKFLOW_INCIDENTS, WORKFLOW_MODES, WORKFLOW_STAGES, buildRfqDraft, buildShipmentWorkflow,
} from './shipment-workflow.js';
import { localCalendarDate } from './logistics.js';

const STORAGE_KEY = 'borderwise-shipment-workflow-v1';
const SHIPMENT_FIELDS = [
  'product', 'hs', 'origin', 'exportCountry', 'destination', 'value', 'currency',
  'incoterm', 'consignee', 'material', 'transport', 'documents', 'notes',
];
const OPTION_FIELDS = { mode: WORKFLOW_MODES, stage: WORKFLOW_STAGES, incident: WORKFLOW_INCIDENTS };
const TEXT_FIELDS = { from: 120, to: 120, load: 160, namedPlace: 120 };

function localStorageOrNull() {
  try { return globalThis.localStorage; } catch { return null; }
}

function shipmentKey(shipment) {
  const fields = SHIPMENT_FIELDS.map(field => String(shipment?.[field] ?? '').trim());
  const data = JSON.stringify(fields);
  let hash = 0x811c9dc5;
  for (let index = 0; index < data.length; index++) {
    hash = Math.imul(hash ^ data.charCodeAt(index), 0x01000193);
  }
  return `${data.length}:${(hash >>> 0).toString(16)}`;
}

function cleanDetails(input) {
  const details = {};
  for (const [field, options] of Object.entries(OPTION_FIELDS)) {
    const value = input?.[field];
    if (typeof value === 'string' && Object.hasOwn(options, value)) details[field] = value;
  }
  for (const [field, limit] of Object.entries(TEXT_FIELDS)) {
    const value = input?.[field];
    if (typeof value === 'string' && value.trim()) details[field] = value.trim().slice(0, limit);
  }
  const date = input?.dueDate;
  if (typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date)) details.dueDate = date;
  return details;
}

export function createWorkflowWorkspace(root, initialShipment, { storage = localStorageOrNull() } = {}) {
  root.innerHTML = `
    <div class="dialog-header">
      <h2 id="workflowDialogTitle">物流执行</h2>
      <button type="button" class="close-button" data-close aria-label="关闭">×</button>
    </div>
    <form class="workflow-form form-grid">
      <label>运输方式 <select name="mode"><option value="">沿用货物资料</option></select></label>
      <label>当前节点 <select name="stage"><option value="">请选择</option></select></label>
      <label>发货地 <input name="from" maxlength="120" placeholder="城市、港口或地址"></label>
      <label>交付地 <input name="to" maxlength="120" placeholder="城市、港口或地址"></label>
      <label>货量 <input name="load" maxlength="160" placeholder="箱型、重量与体积"></label>
      <label>贸易术语指定地点 <input name="namedPlace" maxlength="120" placeholder="例：Hamburg CTA"></label>
      <label>节点截止日 <input type="date" name="dueDate"></label>
      <label>物流异常 <select name="incident"><option value="">无</option></select></label>
      <div class="workflow-form-actions full">
        <button type="button" class="secondary-button" data-workflow-clear>清除物流资料</button>
      </div>
    </form>
    <div class="workflow-results" data-workflow-results></div>
    <section class="workflow-rfq" aria-labelledby="workflowRfqTitle">
      <h3 id="workflowRfqTitle">英文询价草稿</h3>
      <textarea rows="8" lang="en" aria-labelledby="workflowRfqTitle" spellcheck="false" readonly></textarea>
      <div class="workflow-rfq-actions">
        <button type="button" class="secondary-button" data-workflow-copy>复制草稿</button>
        <p class="workflow-status" role="status"></p>
      </div>
    </section>`;

  const document = root.ownerDocument;
  const form = root.querySelector('.workflow-form');
  const results = root.querySelector('[data-workflow-results]');
  const draft = root.querySelector('textarea');
  const status = root.querySelector('.workflow-status');
  const clearButton = root.querySelector('[data-workflow-clear]');
  let shipment = initialShipment ?? {};
  let key = shipmentKey(shipment);
  let details = {};

  function element(tag, content) {
    const node = document.createElement(tag);
    if (content) node.textContent = content;
    return node;
  }

  for (const [name, values] of Object.entries(OPTION_FIELDS)) {
    for (const [id, label] of Object.entries(values)) {
      const option = element('option', label);
      option.value = id;
      form.elements.namedItem(name).append(option);
    }
  }

  function findings(title, rows, ordered = false) {
    const section = element('section');
    section.className = 'workflow-findings';
    const list = element(ordered ? 'ol' : 'ul');
    for (const { label, description, highlighting } of rows) {
      const row = element('li');
      if (highlighting) row.dataset.highlighting = highlighting;
      if (highlighting === 'current') row.setAttribute('aria-current', 'step');
      if (label) row.append(element('strong', label));
      if (description) row.append(element('p', description));
      list.append(row);
    }
    section.append(element('h3', title), list);
    return section;
  }

  function render() {
    const { term, responsibilities, milestones, documents, alerts, incident } =
      buildShipmentWorkflow({ shipment, details, today: localCalendarDate() });
    const sections = [];
    if (alerts.length) sections.push(findings('待处理', alerts.map(({ level, title, action }) => ({
      label: title, description: action, highlighting: level,
    }))));
    if (incident) sections.push(findings(incident.title, incident.steps.map(description => ({ description })), true));
    const termLabel = [term.code, term.title, term.place].filter(Boolean).join(' · ');
    sections.push(findings('贸易术语与分工', [
      { label: termLabel, description: term.note },
      ...responsibilities.map(({ title, detail }) => ({ label: title, description: detail })),
    ]));
    sections.push(findings('节点计划', milestones.map(({ id, title, owner, action }) => ({
      label: [title, owner].filter(Boolean).join(' · '),
      description: action,
      highlighting: details.stage === id ? 'current' : '',
    })), true));
    sections.push(findings('交接单证', documents.map(({ title, check }) => ({ label: title, description: check }))));
    results.replaceChildren(...sections);
    draft.value = buildRfqDraft({ shipment, details });
    clearButton.disabled = !Object.keys(details).length;
  }

  function setForm() {
    form.reset();
    for (const [name, value] of Object.entries(details)) form.elements.namedItem(name).value = value;
    form.elements.from.placeholder = shipment.exportCountry || '城市、港口或地址';
    form.elements.to.placeholder = shipment.destination || '城市、港口或地址';
    details = cleanDetails(Object.fromEntries(new FormData(form)));
  }

  function persist() {
    try {
      if (Object.keys(details).length) storage?.setItem(STORAGE_KEY, JSON.stringify({ shipmentKey: key, details }));
      else storage?.removeItem(STORAGE_KEY);
    } catch { /* Keep the form usable while storage is unavailable. */ }
  }

  function clear() {
    details = {};
    status.textContent = '';
    persist();
    setForm();
    render();
  }

  function activate() {
    status.textContent = '';
    render();
  }

  function setShipment(nextShipment) {
    const nextKey = shipmentKey(nextShipment);
    shipment = nextShipment ?? {};
    if (nextKey !== key) {
      key = nextKey;
      clear();
    } else {
      setForm();
      render();
    }
  }

  try {
    const saved = storage?.getItem(STORAGE_KEY);
    if (saved?.length <= 8000) {
      const parsed = JSON.parse(saved);
      if (parsed?.shipmentKey === key) details = cleanDetails(parsed.details);
    }
  } catch { /* Ignore malformed data and storage failures. */ }
  setForm();
  render();

  form.addEventListener('submit', event => event.preventDefault());
  form.addEventListener('input', () => {
    status.textContent = '';
    details = cleanDetails(Object.fromEntries(new FormData(form)));
    persist();
    render();
  });
  clearButton.addEventListener('click', () => {
    clear();
    form.elements.mode.focus();
  });
  root.querySelector('[data-workflow-copy]').addEventListener('click', async () => {
    try {
      const clipboard = document.defaultView?.navigator.clipboard;
      if (clipboard?.writeText) {
        await clipboard.writeText(draft.value);
        status.textContent = '草稿已复制';
        return;
      }
    } catch { /* Offer manual copying if the browser denies clipboard access. */ }
    draft.focus();
    draft.select();
    status.textContent = '已选中草稿，请手动复制';
  });

  return { setShipment, clear, activate, snapshot: () => Object.keys(details).length ? { ...details } : null };
}
