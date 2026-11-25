import { EXAMPLE_SHIPMENT, SOURCES, analyzeShipment, getLocalFollowUps, localAnswer } from './engine.js';
import { AI_CONFIG } from './ai-config.js';
import { createTradePlanner } from './planning.js';
import { createSessionStore } from './session-store.js';
import { createWorkflowWorkspace } from './shipment-workflow-ui.js';
import { buildRfqDraft, buildShipmentWorkflow, inferWorkflowScenario } from './shipment-workflow.js';
import { localCalendarDate } from './logistics.js';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const icons = {
  plus:'<path d="M12 5v14M5 12h14"/>', message:'<path d="M21 11.5a8.4 8.4 0 0 1-8.6 8.3 9 9 0 0 1-3.5-.7L4 20l1-4a8.1 8.1 0 0 1-1.2-4.3 8.4 8.4 0 0 1 8.6-8.3 8.4 8.4 0 0 1 8.6 8.1Z"/><path d="M8.5 11.5h7"/>',
  file:'<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v5h4M9 12h6M9 16h6"/>', globe:'<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.4 2.4 3.6 5.4 3.6 9s-1.2 6.6-3.6 9c-2.4-2.4-3.6-5.4-3.6-9S9.6 5.4 12 3Z"/>',
  shield:'<path d="M12 22s7-3.2 7-10V5l-7-3-7 3v7c0 6.8 7 10 7 10Z"/><path d="m9 12 2 2 4-4"/>', settings:'<path d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  menu:'<path d="M4 7h16M4 12h16M4 17h16"/>', help:'<circle cx="12" cy="12" r="9"/><path d="M9.6 9a2.5 2.5 0 0 1 4.9.7c0 1.7-2.5 2-2.5 3.8M12 17h.01"/>', package:'<path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z"/><path d="m4 7.5 8 4.5 8-4.5M12 12v9M8 5.3l8 4.4"/>',
  search:'<circle cx="10.7" cy="10.7" r="6.5"/><path d="m16 16 4 4"/>', route:'<circle cx="6" cy="18" r="2"/><circle cx="18" cy="6" r="2"/><path d="M8 18h7a3 3 0 1 0 0-6H9a3 3 0 1 1 0-6h7"/>', sliders:'<path d="M4 7h10m4 0h2M4 17h2m4 0h10"/><circle cx="16" cy="7" r="2"/><circle cx="8" cy="17" r="2"/>',
  'arrow-up':'<path d="M12 19V5m-5 5 5-5 5 5"/>',
  layers:'<path d="m12 3 9 5-9 5-9-5 9-5ZM3 12l9 5 9-5M3 16l9 5 9-5"/>', download:'<path d="M12 3v12m-4-4 4 4 4-4M4 17v3h16v-3"/>', info:'<circle cx="12" cy="12" r="9"/><path d="M12 11v5m0-8h.01"/>'
};
$$('[data-icon]').forEach(element => { element.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${icons[element.dataset.icon] || ''}</svg>`; });

const STORAGE = { shipment:'borderwise-shipment-v1', report:'borderwise-report-v1', settings:'borderwise-settings-v1' };
const PENDING_SIGN_OUT = 'borderwise-ai-sign-out-pending-v1';
const getStored = key => { try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch { return null; } };
const setStored = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch { toast('无法保存到本地浏览器，当前内容仍可使用。'); } };
try { localStorage.removeItem(STORAGE.settings); } catch { /* Ignore legacy settings when storage is unavailable. */ }
let report = getStored(STORAGE.report) || null;
let shipment = report?.input || getStored(STORAGE.shipment) || {};
const workerUrl = new URL(AI_CONFIG.url, location.href).href;
const supportsAISession = window.isSecureContext && new URL(workerUrl).origin === location.origin &&
  !/(?:^|\.)github\.io$/i.test(location.hostname);
let aiConnection = 'local';
let activeSessionCheck = null;
let endingAISession = false;
let redactionToken = '';
let activeReply = null;
let activeVerification = null;
const sessionStore = createSessionStore();
const checkPriority = { high: 0, medium: 1, info: 2 };
let previousFocus = null;
const dialogIds = ['searchDialog', 'caseDialog', 'planningDialog', 'workflowDialog', 'sourcesDialog', 'settingsDialog'];
const planner = createTradePlanner(shipment);
const workflow = createWorkflowWorkspace($('#workflowDialog'), shipment);
const mobileLayout = matchMedia('(max-width: 760px)');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const quoteQuestion = /比价|(?:比较|对比|分析|复核|看.*录入|哪种|哪个|哪家).{0,16}(?:报价|运费|运价|费用|成本|时效|运输方案)|(?:报价|运费|运价|费用|成本|运输方案|时效).{0,16}(?:对比|比较|最低|更低|更快|便宜|差多少)|\b(?:compare|review|analy[sz]e)\b.{0,35}\b(?:quotes?|freight|shipping costs?|transit times?)\b/i;
const inquiryQuestion = /询价|询盘|\b(?:rfq|request for (?:a )?quote|freight inquiry)\b/i;
const workflowQuestion = /物流执行|物流节点|物流流程|运输流程|交接节点|交付节点|履约|订舱|单证清单|截港|截关|物流异常|运输异常|签收|\b(?:incoterms?|shipping workflow|shipping milestones?)\b/i;

function toast(text) {
  const el = $('#toast');
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove('show'), 3000);
}
function setMobileMenu(open) {
  $('#sidebar').classList.toggle('open', open);
  $('#sidebarBackdrop').hidden = !open;
  $('#mobileMenu').setAttribute('aria-expanded', String(open));
  $('#workspace').inert = open;
  $('.skip-link').inert = open;
  document.body.style.overflow = open ? 'hidden' : '';
}

function dismissMobileMenu() {
  setMobileMenu(false);
  $('#mobileMenu').focus();
}

function openDialog(id, focusSelector = 'input:not([type=checkbox]), button') {
  const trigger = document.activeElement;
  previousFocus = mobileLayout.matches && $('#sidebar').contains(trigger) ? $('#mobileMenu') : trigger;
  closeDialogs(false);
  $('.app-shell').inert = true;
  $('#overlay').hidden = false;
  const dialog = $(`#${id}`);
  dialog.hidden = false;
  document.body.style.overflow = 'hidden';
  requestAnimationFrame(() => {
    if (!dialog.hidden) dialog.querySelector(focusSelector)?.focus();
  });
}
function closeDialogs(restoreFocus = true) {
  dialogIds.forEach(id => { $(`#${id}`).hidden = true; });
  cancelVerification();
  $('#settingsForm').elements.token.value = '';
  $('#overlay').hidden = true;
  const dialogWasOpen = $('.app-shell').inert;
  $('.app-shell').inert = false;
  setMobileMenu(false);
  if (restoreFocus && dialogWasOpen && previousFocus instanceof HTMLElement) previousFocus.focus();
}
function setFormValues(input) {
  const form = $('#caseForm');
  for (const element of form.elements) {
    if (element.name) element.value = input?.[element.name] ?? '';
  }
}
function readFormValues() {
  return Object.fromEntries([...new FormData($('#caseForm')).entries()].map(([key, value]) => [key, String(value).trim()]));
}
function showForm() { setFormValues(shipment); openDialog('caseDialog'); }
function showPlanning(tab = 'tariffs') {
  planner.activate(tab);
  openDialog('planningDialog');
}
function showWorkflow() {
  workflow.activate();
  openDialog('workflowDialog', 'select[name="mode"]');
}
function showSources() { openDialog('sourcesDialog'); }
function showSettings() {
  openDialog('settingsDialog', 'input[name="token"]');
  $('#settingsForm').elements.url.value = workerUrl;
  if (endingAISession) connectionStatus('正在断开 AI…');
  else if (activeSessionCheck) connectionStatus('正在检查 AI 连接…');
  else showConnectionState();
}

function connectionStatus(text, isError = false) {
  const status = $('#connectionStatus');
  status.textContent = text;
  status.classList.toggle('is-error', isError);
}

function cancelVerification() {
  activeVerification?.abort();
  activeVerification = null;
  updateMode();
}

function showConnectionState() {
  if (aiConnection === 'unavailable') connectionStatus('暂时无法确认 AI 连接。', true);
  else connectionStatus(canUseAI() ? 'AI 已连接' : '');
}

function sessionRequest(action, { signal, token = '' }) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  return fetch(workerUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify({ action }),
    credentials: 'same-origin',
    redirect: 'error',
    cache: 'no-store',
    signal,
  });
}

async function refreshAISession() {
  if (!supportsAISession || activeSessionCheck || activeVerification || endingAISession) return;
  if (getStored(PENDING_SIGN_OUT) === true) {
    await disconnectAISession();
    return;
  }
  const controller = new AbortController();
  activeSessionCheck = controller;
  updateMode();
  if (!$('#settingsDialog').hidden) connectionStatus('正在检查 AI 连接…');
  let next = 'unavailable';
  try {
    const response = await sessionRequest('session_status', {
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(5000)]),
    });
    if (response.ok) {
      const { connected } = await response.json();
      if (typeof connected === 'boolean') next = connected ? 'connected' : 'local';
    }
  } catch { /* Keep the local assistant usable if the session service is unavailable. */ }
  if (activeSessionCheck !== controller) return;
  activeSessionCheck = null;
  aiConnection = next;
  updateMode();
  if (!$('#settingsDialog').hidden) showConnectionState();
}

async function disconnectAISession() {
  endingAISession = true;
  activeSessionCheck?.abort();
  activeSessionCheck = null;
  cancelVerification();
  $('#settingsForm').elements.token.value = '';
  activeReply?.abort();
  aiConnection = 'local';
  redactionToken = '';
  updateMode();
  connectionStatus('正在断开 AI…');

  let disconnected = !supportsAISession;
  if (supportsAISession) {
    try { localStorage.setItem(PENDING_SIGN_OUT, 'true'); } catch { /* Retry remains available in settings. */ }
    try {
      const response = await sessionRequest('sign_out', { signal: AbortSignal.timeout(12000) });
      disconnected = response.ok && (await response.json())?.connected === false;
    } catch { /* An unverifiable sign-out leaves the local assistant available. */ }
  }
  if (disconnected) forgetPendingSignOut();
  endingAISession = false;
  aiConnection = disconnected ? 'local' : 'unavailable';
  updateMode();
  if (!$('#settingsDialog').hidden) {
    connectionStatus(disconnected ? 'AI 已断开' : '无法断开 AI，请重试。', !disconnected);
    const focused = document.activeElement;
    if (focused === document.body || focused === $('#disconnectAI')) {
      (disconnected ? $('#settingsForm').elements.token : $('#disconnectAI')).focus();
    }
  }
  return disconnected;
}

function forgetPendingSignOut() {
  try { localStorage.removeItem(PENDING_SIGN_OUT); } catch { /* Storage can be unavailable. */ }
}

const toolSearchInput = $('#toolSearchInput');
const toolSearchResults = $$('[data-search-target]', $('#toolSearchForm'));
if (/Mac|iPhone|iPad/i.test(navigator.platform)) $('#searchShortcut').textContent = '⌘ K';

function filterTools() {
  const words = toolSearchInput.value.toLowerCase().trim().split(/\s+/).filter(Boolean);
  for (const result of toolSearchResults) {
    const searchable = (result.textContent + ' ' + result.dataset.searchTerms).toLowerCase();
    result.hidden = !words.every(word => searchable.includes(word));
  }
  $('#toolSearchEmpty').hidden = toolSearchResults.some(result => !result.hidden);
}

function showToolSearch() {
  toolSearchInput.value = '';
  filterTools();
  openDialog('searchDialog', '#toolSearchInput');
}
function levelLabel(level) { return level === 'high' ? '优先复核' : level === 'medium' ? '需确认' : '人工核验'; }

function reviewedChecks(current) {
  const saved = new Set(Array.isArray(current.reviewedIds) ? current.reviewedIds : []);
  return new Set(current.checks.filter(check => saved.has(check.id)).map(check => check.id));
}

function orderedChecks(current) {
  return [...current.checks].sort((a, b) => (checkPriority[a.level] ?? 3) - (checkPriority[b.level] ?? 3));
}

function reviewSummary(current) {
  return `已人工复核 ${reviewedChecks(current).size} / ${current.checks.length} 项`;
}

function updatePanel() {
  const hasReport = !!report && Array.isArray(report.checks);
  const product = hasReport ? (shipment.product || '未命名货物') : '';
  const route = hasReport ? [shipment.origin, shipment.destination].filter(Boolean).join(' → ') : '';
  $('#caseStatus').classList.toggle('ready', hasReport);
  $('#caseStatus').textContent = hasReport ? '已生成清单' : '待开始';
  $('#caseProduct').textContent = product;
  $('#caseProduct').hidden = !product;
  $('#caseDescription').textContent = route;
  $('#caseDescription').hidden = !route;
  $('#caseStatus').setAttribute('aria-label', hasReport ? '已生成清单，不代表合规' : '待开始');
  $('#checkCount').textContent = hasReport ? String(report.checks.length) : '';
  $('#reviewDetails').hidden = !hasReport;
  $('#exportReport').disabled = !hasReport;
  $('#recentCase').hidden = !hasReport;
  $('#historyTitle').textContent = product;
  const list = $('#checklist');
  list.replaceChildren();
  if (!hasReport) return;
  const reviewed = reviewedChecks(report);
  const pending = orderedChecks(report).filter(check => !reviewed.has(check.id));
  const progress = $('#reviewProgress');
  progress.max = Math.max(report.checks.length, 1);
  progress.value = reviewed.size;
  $('#reviewProgressText').textContent = reviewSummary(report);
  for (const check of pending.slice(0, 5)) {
    const row = document.createElement('div'); row.className = 'check-row';
    row.dataset.level = check.level;
    const copy = document.createElement('div'); copy.className = 'check-copy';
    const title = document.createElement('strong'); title.textContent = check.title;
    const subtitle = document.createElement('small'); subtitle.textContent = levelLabel(check.level);
    copy.append(title, subtitle); row.append(copy); list.append(row);
  }
  if (pending.length > 5 || !pending.length) {
    const note = document.createElement('p');
    note.className = 'review-panel-note';
    note.textContent = pending.length ? `另有 ${pending.length - 5} 项待复核` : '所有事项均已标记为人工复核。';
    list.append(note);
  }
}
function clearMessages() {
  $('#messages').replaceChildren();
  $('#intro').hidden = false;
}

function scrollToMessage(node) {
  node.scrollIntoView({ behavior: reducedMotion.matches ? 'instant' : 'smooth', block: 'start' });
}

function addMessage(kind, content) {
  $('#intro').hidden = true;
  const node = document.createElement('article'); node.className = `message ${kind}`;
  const body = document.createElement('div'); body.className = 'message-body';
  const meta = document.createElement('div'); meta.className = 'message-meta';
  meta.textContent = kind === 'user' ? '你' : 'Borderwise';
  const small = document.createElement('small');
  small.textContent = { user: '提问', 'report-message': '复核清单' }[kind] || '本地助手';
  meta.append(small);
  const text = document.createElement('div'); text.className = 'message-text'; text.textContent = content;
  body.append(meta, text); node.append(body); $('#messages').append(node);
  return { node, text, mode: small };
}
function addReport(current, shouldScroll = true) {
  const previous = $$('.report-review-hint', $('#messages')).at(-1);
  if (previous) {
    previous.textContent = '历史版本。请在最新清单更新复核进度。';
    $$('.review-toggle input', previous.closest('.report-preview')).forEach(input => { input.disabled = true; });
  }
  const { node, text } = addMessage('report-message', '资料已整理。以下是辅助复核线索，不代表已经合规、已通过制裁筛查或可直接申报。');
  const preview = document.createElement('div'); preview.className = 'report-preview';
  const title = document.createElement('h4'); title.textContent = `货物复核清单 · ${current.checks.length} 项`;
  title.tabIndex = -1;
  const desc = document.createElement('p'); desc.textContent = '请结合真实货物、目的地规则与官方来源逐项核实。缺少提示不等于没有风险。';
  const summary = document.createElement('p');
  summary.className = 'report-review-summary';
  summary.textContent = reviewSummary(current);
  const hint = document.createElement('p');
  hint.className = 'report-review-hint';
  hint.textContent = '逐项勾选已由人工核实的内容，进度保存在本机。';
  const list = document.createElement('ul');
  const reviewed = reviewedChecks(current);
  for (const check of orderedChecks(current)) {
    const item = document.createElement('li');
    const heading = document.createElement('strong'); heading.textContent = `【${levelLabel(check.level)}】${check.title}`;
    const explanation = document.createElement('p'); explanation.textContent = check.detail || '';
    const action = document.createElement('p'); action.textContent = `下一步：${check.action || '请人工核实。'}`;
    item.append(heading, explanation, action);
    const source = SOURCES.find(entry => entry.id === check.sourceId);
    if (source) { const link = document.createElement('a'); link.href = source.url; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.textContent = `查询入口：${source.title} ↗`; item.append(link); }
    const label = document.createElement('label');
    label.className = 'review-toggle';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = reviewed.has(check.id);
    checkbox.setAttribute('aria-label', `已人工复核：${check.title}`);
    checkbox.addEventListener('change', () => {
      if (current !== report) return;
      if (checkbox.checked) reviewed.add(check.id);
      else reviewed.delete(check.id);
      report.reviewedIds = [...reviewed];
      setStored(STORAGE.report, report);
      summary.textContent = reviewSummary(report);
      updatePanel();
    });
    label.append(checkbox, '已人工复核');
    item.append(label);
    list.append(item);
  }
  const download = document.createElement('button'); download.type = 'button'; download.className = 'report-download'; download.textContent = '下载完整复核清单'; download.addEventListener('click', () => downloadReport(current));
  preview.append(title, desc, summary, hint, list, download); text.append(preview);
  if (shouldScroll) scrollToMessage(node);
}
function canUseAI() {
  return aiConnection === 'connected' && !activeSessionCheck && !endingAISession;
}

function updateMode() {
  const ai = canUseAI();
  const pending = Boolean(activeSessionCheck || endingAISession);
  const label = $('#modeLabel');
  label.textContent = endingAISession ? '正在断开 AI' : activeSessionCheck ? '正在检查 AI 连接' :
    ai ? 'AI 已启用' : '本地检查模式';
  label.classList.toggle('connected', ai);
  $('#chatForm button[type=submit]').disabled = pending || Boolean(activeReply);
  $('#connectAI').disabled = pending || Boolean(activeVerification);
  $('#settingsForm').elements.token.readOnly = endingAISession || Boolean(activeVerification);
  $('#disconnectAI').hidden = aiConnection === 'local' && !endingAISession;
  $('#disconnectAI').disabled = endingAISession;
  $('#clearData').disabled = endingAISession;
}
function inlineMarkdown(parent, text) {
  for (const part of text.split(/(\*\*[^*\n]+\*\*)/g)) {
    if (!part) continue;
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) { const strong = document.createElement('strong'); strong.textContent = part.slice(2, -2); parent.append(strong); }
    else parent.append(document.createTextNode(part.replace(/\*\*/g, '')));
  }
}
function renderMarkdown(target, source) {
  target.replaceChildren(); target.classList.add('rich');
  let list = null; let listType = '';
  const flush = () => { list = null; listType = ''; };
  for (const raw of source.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) { flush(); continue; }
    const heading = /^#{1,4}\s+(.*)$/.exec(line);
    const bullet = /^[-*•]\s+(.*)$/.exec(line);
    const numbered = /^\d+[.、)]\s+(.*)$/.exec(line);
    if (heading) { flush(); const h = document.createElement('h4'); inlineMarkdown(h, heading[1]); target.append(h); }
    else if (bullet || numbered) {
      const type = bullet ? 'ul' : 'ol';
      if (!list || listType !== type) { list = document.createElement(type); listType = type; target.append(list); }
      const li = document.createElement('li'); inlineMarkdown(li, (bullet || numbered)[1]); list.append(li);
    } else { flush(); const p = document.createElement('p'); inlineMarkdown(p, line); target.append(p); }
  }
}
function splitFollowUps(answer) {
  const match = /(?:^|\n)\s*【追问】([^\n]+)\s*$/.exec(answer);
  if (!match) return { body: answer, followUps: [] };
  const followUps = match[1].split(/[｜|]/).map(item => item.trim().replace(/^[\d.、\s-]+/, '')).filter(item => item && item.length <= 60).slice(0, 3);
  return { body: answer.slice(0, match.index).trim(), followUps };
}
function addFollowUps(node, items) {
  if (!items.length) return;
  const wrap = document.createElement('div'); wrap.className = 'follow-ups';
  const label = document.createElement('span'); label.textContent = '接着问'; wrap.append(label);
  for (const item of items) {
    const button = document.createElement('button'); button.type = 'button'; button.textContent = item;
    button.addEventListener('click', () => {
      if (activeReply) return;
      $('#chatInput').focus({ preventScroll: true });
      wrap.remove();
      sendQuestion(item);
    });
    wrap.append(button);
  }
  node.querySelector('.message-body').append(wrap);
}

function addPlanningLinks(node, question) {
  const links = [];
  if (/关税|税率|进口税|tariff/i.test(question)) links.push(['tariffs', '联网查关税']);
  if (/运费|运价|多式联运|运输方案|运输成本|航运费用|供应链风险|freight|multimodal/i.test(question)) {
    links.push(['logistics', '比较运输报价']);
  }
  if (isWorkflowQuestion(question)) links.push(['workflow', '查看物流执行']);
  if (!links.length) return;
  const wrap = document.createElement('div');
  wrap.className = 'follow-ups planning-message-actions';
  for (const [tab, text] of links) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = text;
    button.addEventListener('click', () => { if (tab === 'workflow') showWorkflow(); else showPlanning(tab); });
    wrap.append(button);
  }
  node.querySelector('.message-body').append(wrap);
}

function isWorkflowQuestion(question) {
  return inquiryQuestion.test(question) || workflowQuestion.test(question) || Boolean(inferWorkflowScenario(question));
}

function logisticsContextFor(question) {
  const details = isWorkflowQuestion(question) ? workflow.snapshot() : null;
  const comparison = quoteQuestion.test(question) && !inquiryQuestion.test(question) ? planner.snapshot() : null;
  if (!details && !comparison) return undefined;
  return { date: localCalendarDate(), ...(details && { workflow: details }), ...(comparison && { comparison }) };
}

function localWorkflowAnswer(question, shipment) {
  if (!isWorkflowQuestion(question)) return '';
  const details = workflow.snapshot() || {};
  const input = inferWorkflowScenario(question, shipment, details) || { shipment, details };
  if (inquiryQuestion.test(question)) return buildRfqDraft(input);
  const { term, responsibilities, milestones, documents, alerts, incident } =
    buildShipmentWorkflow({ ...input, today: localCalendarDate() });
  const notes = alerts.slice(0, 3).map(item => `${item.title} · ${item.action}`);
  if (incident) return [incident.title, ...incident.steps.map(step => `• ${step}`), ...notes].join('\n');
  return [
    [term.code, term.title].filter(Boolean).join(' · '),
    term.note,
    ...responsibilities.map(item => `${item.title} · ${item.detail}`),
    `流程 · ${milestones.map(item => item.title).join(' → ')}`,
    `单证 · ${documents.map(item => item.title).join('、')}`,
    ...notes,
  ].filter(Boolean).join('\n');
}

function showLocalAnswer(message, question, currentShipment, fallback = '') {
  message.mode.textContent = '本地助手';
  const answer = localAnswer(question, currentShipment, {
    workflowAnswer: () => localWorkflowAnswer(question, currentShipment),
  });
  message.text.textContent = answer;
  sessionStore.append({ question: redactToken(question, redactionToken), answer: redactToken(answer, redactionToken), mode: 'local' });
  if (fallback) {
    const note = document.createElement('p');
    note.className = 'ai-fallback-note';
    note.textContent = fallback;
    message.text.prepend(note);
  }
  addPlanningLinks(message.node, question);
  addFollowUps(message.node, getLocalFollowUps(question, currentShipment));
}

const toolNames = new Map([
  ['review_shipment', '复核货物资料'],
  ['lookup_tariff', '查询官方税则'],
  ['official_sources', '查找官方入口'],
  ['plan_shipment_workflow', '复核运输节点与单证'],
  ['compare_transport_quotes', '比较实际运输报价'],
  ['draft_freight_inquiry', '生成英文询价草稿'],
]);
const stepLabels = new Map([
  ['ok', '完成'], ['needs_input', '需补资料'], ['unavailable', '暂不可用'],
  ['denied', '未执行'], ['error', '执行失败'],
]);

function addAgentRecord(node, { steps = [], sources = [] }) {
  if (!steps.length && !sources.length) return;
  const record = document.createElement('details');
  record.className = 'agent-record';
  const title = document.createElement('summary');
  title.textContent = '工具记录与来源';
  record.append(title);
  if (steps.length) {
    const list = document.createElement('ul');
    for (const step of steps) {
      const row = document.createElement('li');
      row.textContent = `${toolNames.get(step.name) || '其他工具'} · ${stepLabels.get(step.status) || '状态未知'}`;
      list.append(row);
    }
    record.append(list);
  }
  if (sources.length) {
    const list = document.createElement('ul');
    for (const source of sources) {
      const row = document.createElement('li');
      const link = document.createElement('a');
      link.href = source.url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = source.title;
      row.append(link);
      const type = source.kind === 'lookup' ? '已查询' : '供复核';
      row.append(` · ${type}`);
      if (source.retrievedAt) {
        const time = document.createElement('time');
        time.dateTime = source.retrievedAt;
        time.textContent = new Date(source.retrievedAt).toLocaleString('zh-CN');
        row.append(' · ', time);
      }
      list.append(row);
    }
    record.append(list);
  }
  node.querySelector('.message-body').append(record);
}

function showModelAnswer(message, turn) {
  message.mode.textContent = 'AI 助手';
  renderMarkdown(message.text, turn.answer);
  const note = document.createElement('p');
  note.className = 'ai-note';
  note.textContent = '模型输出可能出错，请按适用日期和完整税则逐项人工复核。';
  message.text.append(note);
  addAgentRecord(message.node, turn);
  addPlanningLinks(message.node, turn.question);
}

function redactToken(text, token) {
  return token ? text.replaceAll(token, '[已隐藏]') : text;
}

async function sendQuestion(question) {
  const content = redactToken(question.trim(), redactionToken);
  if (!content || activeReply) return;
  if (activeSessionCheck || endingAISession) {
    toast('正在处理 AI 连接，请稍后发送。');
    return;
  }
  $('#chatInput').value = '';
  addMessage('user', content);
  const currentShipment = shipment;
  if (!canUseAI()) {
    const message = addMessage('assistant', '');
    const note = aiConnection === 'unavailable' ? '暂时无法确认 AI 连接，本次由本地助手回答。' : '';
    showLocalAnswer(message, content, currentShipment, note);
    scrollToMessage(message.node);
    return;
  }

  const controller = new AbortController();
  activeReply = controller;
  updateMode();
  const message = addMessage('assistant', '正在整理待核验事项…');
  message.mode.textContent = 'AI 助手';
  message.node.classList.add('pending');
  const token = redactionToken;
  try {
    const reportContext = report && { checks: report.checks, generatedAt: report.generatedAt, input: report.input };
    const logistics = logisticsContextFor(content);
    const response = await fetch(workerUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      redirect: 'error',
      body: JSON.stringify({
        protocol: 2, question: content, shipment: currentShipment, report: reportContext,
        history: sessionStore.history(workerUrl), logistics,
      }),
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(60000)])
    });
    if (controller.signal.aborted) return;
    if (response.status === 401) {
      aiConnection = 'local';
      if (!$('#settingsDialog').hidden && !activeVerification) connectionStatus('AI 连接已失效，请重新验证 Token。', true);
      showLocalAnswer(message, content, currentShipment, 'AI 连接已失效，本次由本地助手回答。');
      return;
    }
    const payload = await response.json();
    if (controller.signal.aborted) return;
    if (!response.ok || typeof payload.answer !== 'string' || !payload.answer.trim()) throw new Error('AI 服务未返回有效内容。');
    const answer = redactToken(payload.answer, token);
    const { body, followUps } = splitFollowUps(answer.trim());
    if (!body) throw new Error('AI 服务未返回有效内容。');
    const turn = { question: content, answer: body, mode: 'ai', scope: workerUrl, steps: payload.steps, sources: payload.sources };
    if (!sessionStore.append(turn, token)) throw new Error('AI 服务未返回有效内容。');
    showModelAnswer(message, sessionStore.turns().at(-1));
    addFollowUps(message.node, followUps.length ? followUps : getLocalFollowUps(content, currentShipment));
  } catch {
    if (!controller.signal.aborted) {
      showLocalAnswer(message, content, currentShipment, 'AI 服务未能回答，本次已切换为本地回答。可在设置中检查连接。');
    }
  } finally {
    activeReply = null;
    updateMode();
    if (controller.signal.aborted) message.node.remove();
    else {
      message.node.classList.remove('pending');
      scrollToMessage(message.node);
    }
  }
}
function markdownReport(current) {
  const lines = ['# Borderwise 货物复核清单','',`生成时间：${current.generatedAt || new Date().toISOString()}`,'','> 本清单为辅助提示，不构成法律意见或申报结论。未核验实时法规和制裁名单，未提示不代表无风险。','', '## 货物资料'];
  const labels = {product:'商品名称',hs:'HS 编码',origin:'原产地',exportCountry:'出口地',destination:'目的地',value:'货值',currency:'币种',incoterm:'贸易术语',consignee:'收货方',material:'材质与用途',transport:'运输方式',documents:'已有单证',notes:'其他说明'};
  for (const [key, label] of Object.entries(labels)) lines.push(`- ${label}：${String(current.input?.[key] || '未填写').replace(/[\r\n]+/g, ' ')}`);
  const reviewed = reviewedChecks(current);
  lines.push('', '## 人工复核事项', '', reviewSummary(current));
  for (const check of orderedChecks(current)) {
    const source = SOURCES.find(entry => entry.id === check.sourceId);
    lines.push('', `### ${levelLabel(check.level)} · ${check.title}`, '', `- [${reviewed.has(check.id) ? 'x' : ' '}] 已人工复核`, '', String(check.detail || ''), '', `建议：${String(check.action || '请人工核实')}`, ...(source ? ['', `查询入口：${source.title} — ${source.url}`] : []));
  }
  lines.push('', '## 官方查询入口', '', '- 欧盟 Access2Markets：https://trade.ec.europa.eu/access-to-markets/en/home', '- 欧盟 CBAM：https://taxation-customs.ec.europa.eu/carbon-border-adjustment-mechanism_en', '- OFAC 制裁名单：https://ofac.treasury.gov/sanctions-list-service', '- 中国海关：https://online.customs.gov.cn/static/pages/mySearch.html', '', '---', '由 Borderwise 本地辅助检查生成；请由专业人员核验并结合适用时间、主体、货物及真实资料作判断。', '');
  return lines.join('\n');
}
function downloadReport(current) {
  if (!current || !Array.isArray(current.checks)) return;
  const blob = new Blob([markdownReport(current)], { type:'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = 'borderwise-复核清单.md'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}

$('#newTask').addEventListener('click', () => {
  if ((report || workflow.snapshot() || planner.snapshot()) &&
      !window.confirm('开始新分析会清除当前的清单、物流记录和报价。继续吗？')) return;
  activeReply?.abort();
  sessionStore.clear();
  shipment = {}; report = null; setStored(STORAGE.shipment, shipment); setStored(STORAGE.report, report); clearMessages(); updatePanel(); setMobileMenu(false); $('#chatInput').focus(); toast('已开启新分析');
  planner.setShipment(shipment);
  workflow.clear();
  workflow.setShipment(shipment);
});
$('#navChat').addEventListener('click', () => { closeDialogs(); $('#chatInput').focus(); });
$('#navForm').addEventListener('click', showForm); $('#attachCase').addEventListener('click', showForm); $('#panelForm').addEventListener('click', showForm); $('#historyButton').addEventListener('click', showForm);
$('#navPlanning').addEventListener('click', () => showPlanning());
$('#panelPlanning').addEventListener('click', () => showPlanning());
$('#toolForm').addEventListener('click', showForm);
$('#toolPlanning').addEventListener('click', () => showPlanning());
$('#navWorkflow').addEventListener('click', showWorkflow);
$('#toolWorkflow').addEventListener('click', showWorkflow);
$('#askAgentAboutQuotes').addEventListener('click', () => {
  const status = $('#logisticsStatus');
  if (!planner.snapshot()) {
    status.textContent = '请填写共同起讫点、货量和至少两个实际运输方案。';
    return;
  }
  if (activeSessionCheck || endingAISession) {
    status.textContent = '正在处理 AI 连接，请稍后重试。';
    return;
  }
  if (!canUseAI()) {
    status.textContent = '连接 AI 后可以在对话中分析，也可直接在此比较成本与时效。';
    return;
  }
  if (activeReply) return;
  closeDialogs(false);
  $('#chatInput').focus();
  sendQuestion('请比较我录入的运输报价，说明成本、时效、适用范围和待确认的费用。');
});
$('#toolSources').addEventListener('click', showSources);
$('#navSources').addEventListener('click', showSources); $('#topSources').addEventListener('click', showSources); $('#moreSources').addEventListener('click', showSources);
$('#openSettings').addEventListener('click', showSettings);
$('#sidebarSearch').addEventListener('click', showToolSearch);
$('#topSearch').addEventListener('click', showToolSearch);
toolSearchInput.addEventListener('input', filterTools);
for (const result of toolSearchResults) {
  result.addEventListener('click', () => {
    closeDialogs();
    document.getElementById(result.dataset.searchTarget).click();
  });
}
$('#toolSearchForm').addEventListener('submit', event => {
  event.preventDefault();
  toolSearchResults.find(result => !result.hidden)?.click();
});
$('#mobileMenu').addEventListener('click', () => {
  setMobileMenu(true);
  $('#closeMobileMenu').focus();
});
$('#closeMobileMenu').addEventListener('click', dismissMobileMenu);
$('#sidebarBackdrop').addEventListener('click', dismissMobileMenu);
mobileLayout.addEventListener('change', () => {
  if (!mobileLayout.matches && $('#sidebar').classList.contains('open')) {
    setMobileMenu(false);
    $('#navChat').focus();
  }
});
$('#overlay').addEventListener('click', () => closeDialogs());
$$('[data-close]').forEach(button => button.addEventListener('click', () => closeDialogs()));
document.addEventListener('keydown', event => {
  if (event.key.toLowerCase() === 'k' && (event.metaKey || event.ctrlKey) && !event.altKey &&
      location.hash === '#workspace' && !$('.app-shell').inert && !event.isComposing) {
    event.preventDefault();
    showToolSearch();
    return;
  }
  if (event.key !== 'Escape') return;
  if ($('#sidebar').classList.contains('open')) dismissMobileMenu();
  else if ($('.app-shell').inert) closeDialogs();
});
$('#fillExample').addEventListener('click', () => { setFormValues(EXAMPLE_SHIPMENT); toast('已填入演示资料，请按实际业务修改'); });
$('#caseForm').addEventListener('submit', event => {
  event.preventDefault();
  const next = analyzeShipment(readFormValues());
  const previousReviewed = report && Array.isArray(report.checks) ? reviewedChecks(report) : new Set();
  const sameShipment = Array.isArray(report?.checks) &&
    Object.entries(next.input).every(([key, value]) => value === report.input?.[key]);
  if (sameShipment) {
    const previousChecks = new Map(report.checks.map(check => [check.id, check]));
    next.reviewedIds = next.checks.filter(check => previousReviewed.has(check.id) &&
      JSON.stringify(check) === JSON.stringify(previousChecks.get(check.id))).map(check => check.id);
  } else {
    activeReply?.abort();
    sessionStore.clear();
  }
  shipment = next.input;
  if (!sameShipment) {
    planner.setShipment(shipment);
    workflow.setShipment(shipment);
  }
  report = next;
  setStored(STORAGE.shipment, shipment);
  setStored(STORAGE.report, report);
  updatePanel();
  closeDialogs();
  addReport(report);
  const removedReviews = previousReviewed.size - reviewedChecks(report).size;
  toast(removedReviews ? `已重新生成清单，${removedReviews} 项需重新复核` : '复核清单已生成');
});
$('#chatForm').addEventListener('submit', event => { event.preventDefault(); sendQuestion($('#chatInput').value); });
$('#chatInput').addEventListener('keydown', event => { if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); sendQuestion(event.currentTarget.value); } });
$$('.suggestion').forEach(button => button.addEventListener('click', () => {
  $('#chatInput').focus({ preventScroll: true });
  sendQuestion(button.dataset.question || '');
}));
$('#exportReport').addEventListener('click', () => downloadReport(report));
$('#viewReview').addEventListener('click', () => {
  const heading = $$('.report-preview h4', $('#messages')).at(-1);
  if (!heading) return;
  heading.focus({ preventScroll: true });
  scrollToMessage(heading.closest('.message'));
});
$('#settingsForm').addEventListener('submit', async event => {
  event.preventDefault();
  if (activeVerification || activeSessionCheck || endingAISession) return;
  if (!supportsAISession) {
    connectionStatus('请在 Borderwise 的 Cloudflare 站点验证 Token。', true);
    return;
  }
  const tokenInput = event.currentTarget.elements.token;
  const token = tokenInput.value;
  if (!/^[\x21-\x7e]{1,512}$/.test(token)) {
    connectionStatus('请输入 1–512 位无空格的 ASCII Token。', true);
    tokenInput.focus();
    return;
  }

  const controller = new AbortController();
  const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(12000)]);
  activeVerification = controller;
  updateMode();
  connectionStatus('正在验证 Token…');
  try {
    const response = await sessionRequest('verify_token', { signal, token });
    if (activeVerification !== controller) return;
    if (response.status === 401) {
      connectionStatus('Token 无效，请核对后重试。', true);
      tokenInput.focus();
      return;
    }
    if (!response.ok || (await response.json())?.verified !== true) throw new Error('Token verification unavailable');
    if (activeVerification !== controller) return;
    const status = await sessionRequest('session_status', { signal });
    if (!status.ok) throw new Error('AI session unavailable');
    const { connected } = await status.json();
    if (activeVerification !== controller) return;
    if (connected !== true) {
      connectionStatus('Token 已验证，但未能建立浏览器会话。', true);
      return;
    }

    activeReply?.abort();
    redactionToken = token;
    aiConnection = 'connected';
    forgetPendingSignOut();
    updateMode();
    closeDialogs();
    toast('Token 已验证，AI 已连接');
  } catch {
    if (activeVerification === controller) connectionStatus('暂时无法验证 Token，请稍后重试。', true);
  } finally {
    if (activeVerification === controller) cancelVerification();
  }
});
$('#disconnectAI').addEventListener('click', async () => {
  if (endingAISession) return;
  const disconnected = await disconnectAISession();
  toast(disconnected ? '已切换到本地模式' : '无法断开 AI，请重试。');
});
$('#clearData').addEventListener('click', async () => {
  if (endingAISession || !window.confirm('确定断开 AI 并清除货物资料、清单、物流资料和当前标签页的对话？此操作不可撤销。')) return;
  const signOut = disconnectAISession();
  Object.values(STORAGE).forEach(key => { try { localStorage.removeItem(key); } catch {} });
  sessionStore.clear();
  shipment = {}; report = null; setFormValues({}); clearMessages(); updatePanel();
  planner.setShipment(shipment);
  workflow.clear();
  workflow.setShipment(shipment);
  toast(await signOut ? '本网站的本地数据已清除' : '本地数据已清除，无法断开 AI，请重试。');
});
updatePanel(); updateMode();
if (report && Array.isArray(report.checks)) addReport(report, false);
for (const turn of sessionStore.turns()) {
  addMessage('user', turn.question);
  const message = addMessage('assistant', turn.answer);
  if (turn.mode === 'ai') showModelAnswer(message, turn);
  else {
    addPlanningLinks(message.node, turn.question);
    addFollowUps(message.node, getLocalFollowUps(turn.question, shipment));
  }
}

refreshAISession();
window.addEventListener('pageshow', event => { if (event.persisted) refreshAISession(); });

window.addEventListener('hashchange', () => {
  const inWorkspace = location.hash === '#workspace';
  if (!inWorkspace) closeDialogs(false);
  const heading = inWorkspace ? $('#workspace') : $('#entranceTitle');
  heading.focus({ preventScroll: true });
  window.scrollTo(0, 0);
});
