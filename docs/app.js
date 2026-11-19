import { EXAMPLE_SHIPMENT, SOURCES, analyzeShipment, getLocalFollowUps, localAnswer } from './engine.js';
import { AI_CONFIG } from './ai-config.js';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const icons = {
  plus:'<path d="M12 5v14M5 12h14"/>', message:'<path d="M21 11.5a8.4 8.4 0 0 1-8.6 8.3 9 9 0 0 1-3.5-.7L4 20l1-4a8.1 8.1 0 0 1-1.2-4.3 8.4 8.4 0 0 1 8.6-8.3 8.4 8.4 0 0 1 8.6 8.1Z"/><path d="M8.5 11.5h7"/>',
  file:'<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v5h4M9 12h6M9 16h6"/>', globe:'<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.4 2.4 3.6 5.4 3.6 9s-1.2 6.6-3.6 9c-2.4-2.4-3.6-5.4-3.6-9S9.6 5.4 12 3Z"/>',
  shield:'<path d="M12 22s7-3.2 7-10V5l-7-3-7 3v7c0 6.8 7 10 7 10Z"/><path d="m9 12 2 2 4-4"/>', settings:'<path d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  menu:'<path d="M4 7h16M4 12h16M4 17h16"/>', help:'<circle cx="12" cy="12" r="9"/><path d="M9.6 9a2.5 2.5 0 0 1 4.9.7c0 1.7-2.5 2-2.5 3.8M12 17h.01"/>', package:'<path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z"/><path d="m4 7.5 8 4.5 8-4.5M12 12v9M8 5.3l8 4.4"/>',
  search:'<circle cx="10.7" cy="10.7" r="6.5"/><path d="m16 16 4 4"/>', route:'<circle cx="6" cy="18" r="2"/><circle cx="18" cy="6" r="2"/><path d="M8 18h7a3 3 0 1 0 0-6H9a3 3 0 1 1 0-6h7"/>', sliders:'<path d="M4 7h10m4 0h2M4 17h2m4 0h10"/><circle cx="16" cy="7" r="2"/><circle cx="8" cy="17" r="2"/>',
  'arrow-up':'<path d="M12 19V5m-5 5 5-5 5 5"/>', sparkle:'<path d="m12 3 1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3ZM19 16l.7 2.3L22 19l-2.3.7L19 22l-.7-2.3L16 19l2.3-.7L19 16Z"/>',
  layers:'<path d="m12 3 9 5-9 5-9-5 9-5ZM3 12l9 5 9-5M3 16l9 5 9-5"/>', 'check-circle':'<circle cx="12" cy="12" r="9"/><path d="m8 12 2.5 2.5L16 9"/>', download:'<path d="M12 3v12m-4-4 4 4 4-4M4 17v3h16v-3"/>', info:'<circle cx="12" cy="12" r="9"/><path d="M12 11v5m0-8h.01"/>'
};
$$('[data-icon]').forEach(element => { element.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${icons[element.dataset.icon] || ''}</svg>`; });

const STORAGE = { shipment:'borderwise-shipment-v1', report:'borderwise-report-v1', settings:'borderwise-settings-v1' };
const getStored = key => { try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch { return null; } };
const setStored = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch { toast('无法保存到本地浏览器，当前内容仍可使用。'); } };
let report = getStored(STORAGE.report) || null;
let shipment = report?.input || getStored(STORAGE.shipment) || {};
const savedSettings = getStored(STORAGE.settings) || {};
const defaultUrl = typeof AI_CONFIG.url === 'string' ? AI_CONFIG.url.trim().replace(/\/$/, '') : '';
let settings = { url: savedSettings.url || defaultUrl, enabled: typeof savedSettings.enabled === 'boolean' ? savedSettings.enabled : Boolean(AI_CONFIG.enabled && defaultUrl), token: '' };
let activeReply = null;
let chatHistory = [];
const MAX_HISTORY = 8;
const checkPriority = { high: 0, medium: 1, info: 2 };
let previousFocus = null;
const dialogIds = ['caseDialog', 'sourcesDialog', 'settingsDialog'];
const mobileLayout = matchMedia('(max-width: 760px)');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

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

function openDialog(id) {
  const trigger = document.activeElement;
  previousFocus = mobileLayout.matches && $('#sidebar').contains(trigger) ? $('#mobileMenu') : trigger;
  closeDialogs(false);
  $('.app-shell').inert = true;
  $('#overlay').hidden = false;
  const dialog = $(`#${id}`);
  dialog.hidden = false;
  document.body.style.overflow = 'hidden';
  requestAnimationFrame(() => dialog.querySelector('input:not([type=checkbox]), button')?.focus());
}
function closeDialogs(restoreFocus = true) {
  dialogIds.forEach(id => { $(`#${id}`).hidden = true; });
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
function showSources() { openDialog('sourcesDialog'); }
function showSettings() {
  const form = $('#settingsForm');
  openDialog('settingsDialog');
  form.elements.url.value = settings.url;
  form.elements.enabled.checked = settings.enabled;
  form.elements.token.value = settings.token;
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
  $('#caseStatus').classList.toggle('ready', hasReport);
  $('#caseStatus').innerHTML = hasReport ? '<span></span> 已生成清单' : '<span></span> 待开始';
  $('#caseProduct').textContent = hasReport ? (shipment.product || '未命名货物') : '新的分析';
  $('#caseDescription').textContent = hasReport ? [shipment.origin, shipment.destination].filter(Boolean).join(' → ') || '已生成资料复核清单' : '尚未填写货物资料';
  $('#caseStatus').setAttribute('aria-label', hasReport ? '已生成清单，不代表合规' : '待开始');
  $('#checkCount').textContent = hasReport ? String(report.checks.length) : '—';
  $('#exportReport').disabled = !hasReport;
  $('#viewReview').hidden = !hasReport;
  $('#reviewProgressGroup').hidden = !hasReport;
  $('#historyTitle').textContent = hasReport ? (shipment.product || '未命名货物') : '暂无已保存的分析';
  const list = $('#checklist');
  list.replaceChildren();
  if (!hasReport) {
    const empty = document.createElement('div'); empty.className = 'empty-check';
    empty.innerHTML = '<span class="empty-check-icon"><span class="icon"><svg viewBox="0 0 24 24" aria-hidden="true">'+icons['check-circle']+'</svg></span></span><strong>清单将在这里生成</strong>';
    list.append(empty); return;
  }
  const reviewed = reviewedChecks(report);
  const pending = orderedChecks(report).filter(check => !reviewed.has(check.id));
  const progress = $('#reviewProgress');
  progress.max = Math.max(report.checks.length, 1);
  progress.value = reviewed.size;
  $('#reviewProgressText').textContent = reviewSummary(report);
  for (const check of pending.slice(0, 5)) {
    const row = document.createElement('div'); row.className = 'check-row';
    const dot = document.createElement('span'); dot.className = `check-dot ${['high','medium','info'].includes(check.level) ? check.level : 'info'}`;
    const copy = document.createElement('div'); copy.className = 'check-copy';
    const title = document.createElement('strong'); title.textContent = check.title;
    const subtitle = document.createElement('small'); subtitle.textContent = levelLabel(check.level);
    copy.append(title, subtitle); row.append(dot, copy); list.append(row);
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
  const avatar = document.createElement('div'); avatar.className = 'message-avatar'; avatar.textContent = kind === 'user' ? '我' : '〇';
  const body = document.createElement('div'); body.className = 'message-body';
  const meta = document.createElement('div'); meta.className = 'message-meta';
  meta.textContent = kind === 'user' ? '你' : 'Borderwise';
  const small = document.createElement('small');
  small.textContent = { user: '提问', 'report-message': '复核清单' }[kind] || '本地助手';
  meta.append(small);
  const text = document.createElement('div'); text.className = 'message-text'; text.textContent = content;
  body.append(meta, text); node.append(avatar, body); $('#messages').append(node);
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
  const download = document.createElement('button'); download.type = 'button'; download.className = 'report-download'; download.textContent = '下载完整复核清单 ↓'; download.addEventListener('click', () => downloadReport(current));
  preview.append(title, desc, summary, hint, list, download); text.append(preview);
  if (shouldScroll) scrollToMessage(node);
}
function canUseAI() {
  return Boolean(settings.enabled && settings.url && (AI_CONFIG.publicAccess || settings.token));
}

function updateMode() {
  const ai = canUseAI();
  $('#modeLabel').textContent = ai ? 'AI 已启用' : (settings.enabled ? 'AI 待连接' : '本地检查模式');
  $('#composerMode').innerHTML = ai ? '<span></span> AI 对话模式' : '<span></span> 本地辅助模式';
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
function showLocalAnswer(message, question, currentShipment, fallback = '') {
  message.mode.textContent = '本地助手';
  message.text.textContent = localAnswer(question, currentShipment);
  if (fallback) {
    const note = document.createElement('p');
    note.className = 'ai-fallback-note';
    note.textContent = fallback;
    message.text.prepend(note);
  }
  addFollowUps(message.node, getLocalFollowUps(question, currentShipment));
}

async function sendQuestion(question) {
  const content = question.trim();
  if (!content || activeReply) return;
  $('#chatInput').value = '';
  addMessage('user', content);
  const currentShipment = shipment;
  if (!canUseAI()) {
    const message = addMessage('assistant', '');
    const note = settings.enabled ? 'AI 待连接，本次由本地助手回答。可在设置中重新连接。' : '';
    showLocalAnswer(message, content, currentShipment, note);
    scrollToMessage(message.node);
    return;
  }

  const controller = new AbortController();
  activeReply = controller;
  const submit = $('#chatForm button[type=submit]');
  submit.disabled = true;
  const message = addMessage('assistant', '正在整理待核验事项…');
  message.mode.textContent = 'AI 助手';
  message.node.classList.add('pending');
  try {
    const reportContext = report && { checks: report.checks, generatedAt: report.generatedAt, input: report.input };
    const response = await fetch(settings.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${settings.token}` },
      body: JSON.stringify({ question: content, shipment: currentShipment, report: reportContext, history: chatHistory }),
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(60000)])
    });
    const payload = await response.json();
    if (controller.signal.aborted) return;
    if (!response.ok || typeof payload.answer !== 'string' || !payload.answer.trim()) throw new Error('AI 服务未返回有效内容。');
    const { body, followUps } = splitFollowUps(payload.answer.trim());
    if (!body) throw new Error('AI 服务未返回有效内容。');
    renderMarkdown(message.text, body);
    const note = document.createElement('p');
    note.className = 'ai-note';
    note.textContent = '模型输出可能出错，未核验实时法规；请查看官方来源并由专业人员复核。';
    message.text.append(note);
    addFollowUps(message.node, followUps.length ? followUps : getLocalFollowUps(content, currentShipment));
    chatHistory.push({ role: 'user', content }, { role: 'assistant', content: body });
    chatHistory = chatHistory.slice(-MAX_HISTORY);
  } catch {
    if (!controller.signal.aborted) {
      showLocalAnswer(message, content, currentShipment, 'AI 服务未能回答，本次已切换为本地回答。可在设置中检查连接。');
    }
  } finally {
    activeReply = null;
    submit.disabled = false;
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
  if (report && !window.confirm('开始新分析会清除当前浏览器保存的上一份清单。请先导出需要保留的内容。继续吗？')) return;
  activeReply?.abort();
  chatHistory = []; shipment = {}; report = null; setStored(STORAGE.shipment, shipment); setStored(STORAGE.report, report); clearMessages(); updatePanel(); setMobileMenu(false); $('#chatInput').focus(); toast('已开启新分析');
});
$('#navChat').addEventListener('click', () => { closeDialogs(); $('#chatInput').focus(); });
$('#navForm').addEventListener('click', showForm); $('#attachCase').addEventListener('click', showForm); $('#panelForm').addEventListener('click', showForm); $('#historyButton').addEventListener('click', showForm);
$('#navSources').addEventListener('click', showSources); $('#topSources').addEventListener('click', showSources); $('#moreSources').addEventListener('click', showSources);
$('#openSettings').addEventListener('click', showSettings);
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
    chatHistory = [];
  }
  shipment = next.input;
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
$('#settingsForm').addEventListener('submit', event => {
  event.preventDefault(); const form = event.currentTarget; const enabled = form.elements.enabled.checked; const url = form.elements.url.value.trim().replace(/\/$/, ''); const token = form.elements.token.value;
  if (enabled) {
    if (/(?:^|\.)github\.io$/i.test(location.hostname)) { toast('GitHub Pages 不适合发送访问口令；请改用其他合适的静态托管。'); return; }
    let parsed; try { parsed = new URL(url); } catch { toast('请填写有效的 Worker 地址'); return; }
    if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && ['localhost','127.0.0.1'].includes(parsed.hostname))) { toast('请使用 HTTPS Worker 地址'); return; }
    if (parsed.username || parsed.password) { toast('Worker 地址中不能包含账号或密码'); return; }
  }
  if ((token || (enabled && !AI_CONFIG.publicAccess)) && !/^[\x21-\x7e]{1,300}$/.test(token)) { toast('访问口令须为 1–300 位无空格的可打印 ASCII 字符'); return; }
  if (enabled && !AI_CONFIG.publicAccess && !token) { toast('请填写 Worker 访问口令，或在 ai-config.js 中确认公开访客模式'); return; }
  activeReply?.abort();
  chatHistory = [];
  settings = { enabled, url, token }; setStored(STORAGE.settings, { url, enabled }); updateMode(); closeDialogs(); toast(enabled ? 'AI 模式已启用，请注意数据会发送至服务商' : '已切换到本地模式');
});
$('#clearData').addEventListener('click', () => {
  if (!window.confirm('确定清除此浏览器中保存的货物资料、复核清单及设置？此操作不可撤销。')) return;
  activeReply?.abort();
  Object.values(STORAGE).forEach(key => { try { localStorage.removeItem(key); } catch {} });
  chatHistory = []; shipment = {}; report = null; settings = { enabled:false, url:'', token:'' }; setFormValues({}); clearMessages(); updatePanel(); updateMode(); closeDialogs(); toast('本网站的本地数据已清除');
});
updatePanel(); updateMode();
if (report && Array.isArray(report.checks)) addReport(report, false);
