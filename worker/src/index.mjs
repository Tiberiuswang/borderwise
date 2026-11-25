import { runAgent } from './application/agent-service.mjs';
import { createModelClient } from './adapters/model-client.mjs';
import { createRequestSessionStore } from './adapters/session-store.mjs';
import { createTradeTools } from './adapters/trade-tools.mjs';
import { createLogisticsTools } from './adapters/logistics-tools.mjs';
import { createWebTools } from './adapters/web-tools.mjs';
import { expireBrowserSession, isBrowserSessionRequest, issueBrowserSession, verifyBrowserSession } from './domain/browser-session.mjs';
import { buildSystemPrompt } from './domain/instructions.mjs';

const MAX_BODY_BYTES = 64 * 1024;
const MAX_QUESTION_CHARS = 2000; 
const MAX_SHIPMENT_BYTES = 16 * 1024;
const MAX_REPORT_BYTES = 32 * 1024;
const MAX_LOGISTICS_BYTES = 8 * 1024;
const UPSTREAM_TIMEOUT_MS = 30_000;
const encoder = new TextEncoder();

const MAX_HISTORY_ITEMS = 8;

function response(status, data, origin, extraHeaders = {}) {
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    Vary: 'Origin',
    ...extraHeaders,
  };
  if (origin) headers['Access-Control-Allow-Origin'] = origin;
  return new Response(JSON.stringify(data), { status, headers });
}

function validOrigin(value) {
  if (typeof value !== 'string' || !value) return false;
  try {
    const url = new URL(value);
    
    return url.protocol === 'https:' && url.origin === value;
  } catch {
    return false;
  }
}


async function tokenMatches(supplied, expected) {
  const [a, b] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(supplied)),
    crypto.subtle.digest('SHA-256', encoder.encode(expected)),
  ]);
  const aa = new Uint8Array(a);
  const bb = new Uint8Array(b);
  let difference = 0;
  for (let i = 0; i < aa.length; i++) difference |= aa[i] ^ bb[i];
  return difference === 0;
}

function validBearer(request, expected) {
  const match = /^Bearer ([\x21-\x7e]{1,512})$/i.exec(request.headers.get('Authorization') || '');
  return match ? tokenMatches(match[1], expected) : false;
}

function unauthorized(origin) {
  return response(401, { error: '访问口令无效。' }, origin, { 'WWW-Authenticate': 'Bearer' });
}

class SizeLimitError extends Error {}


async function readBytes(stream, limit) {
  if (!stream) return new Uint8Array();
  const reader = stream.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
       
        reader.cancel().catch(() => {});
        throw new SizeLimitError();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const result = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

function contextSize(value) {
  return encoder.encode(JSON.stringify(value)).byteLength;
}

function validContext(value) {
  return value === null || typeof value === 'string' || typeof value === 'object';
}

async function handle(request, env) {
  const allowedOrigin = env.ALLOWED_ORIGIN;
  
  if (!validOrigin(allowedOrigin)) {
    return response(500, { error: '服务配置不完整，请联系部署者。' });
  }
  const origin = request.headers.get('Origin');
  if (origin !== allowedOrigin) {
    return response(403, { error: '不允许此请求来源。' });
  }

  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': allowedOrigin,
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Authorization, Content-Type',
        'Access-Control-Max-Age': '600',
        Vary: 'Origin',
        'Cache-Control': 'no-store',
      },
    });
  }
  if (request.method !== 'POST') {
    return response(405, { error: '只支持 POST 请求。' }, origin, { Allow: 'POST, OPTIONS' });
  }
  const publicAccess = env.PUBLIC_ACCESS === 'true';
  const client = createModelClient(env, { readBytes });
  const configured = Boolean(client && (publicAccess || (typeof env.APP_TOKEN === 'string' && env.APP_TOKEN)));
  const browserRequest = isBrowserSessionRequest(request, origin);
  if (!browserRequest && !configured) {
    return response(500, { error: '服务配置不完整，请联系部署者。' }, origin);
  }
  if (!browserRequest && !publicAccess && !(await validBearer(request, env.APP_TOKEN))) {
    return unauthorized(origin);
  }
  const contentType = (request.headers.get('Content-Type') || '').split(';', 1)[0].trim().toLowerCase();
  if (contentType !== 'application/json') {
    return response(415, { error: '请使用 application/json 请求。' }, origin);
  }
  const declaredLength = request.headers.get('Content-Length');
  if (declaredLength && /^\d+$/.test(declaredLength) && Number(declaredLength) > MAX_BODY_BYTES) {
    return response(413, { error: '请求过大，请缩短问题和上下文。' }, origin);
  }

  let payload;
  try {
    const bytes = await readBytes(request.body, MAX_BODY_BYTES);
    payload = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch (error) {
    if (error instanceof SizeLimitError) {
      return response(413, { error: '请求过大，请缩短问题和上下文。' }, origin);
    }
    return response(400, { error: '请求不是有效的 UTF-8 JSON。' }, origin);
  }
  const action = payload?.action;
  const session = {
    origin,
    appToken: env.APP_TOKEN,
    secret: typeof env.AI_SESSION_SECRET === 'string' && env.AI_SESSION_SECRET.trim()
      ? env.AI_SESSION_SECRET : client?.providerKey,
  };
  if (action === 'session_status' || action === 'sign_out') {
    if (!browserRequest) return response(403, { error: '此操作需要站内 AI 服务。' }, origin);
    if (action === 'sign_out') {
      return response(200, { connected: false }, origin, { 'Set-Cookie': expireBrowserSession() });
    }
    const connected = configured && !publicAccess && await verifyBrowserSession(request, session);
    return response(200, { connected }, origin);
  }

  if (!configured) return response(500, { error: '服务配置不完整，请联系部署者。' }, origin);
  if (action === 'verify_token') {
    if (publicAccess) return response(403, { error: '此服务未启用 Token 验证。' }, origin);
    if (!browserRequest) return response(200, { verified: true }, origin);
    if (!(await validBearer(request, env.APP_TOKEN))) return unauthorized(origin);
    const cookie = await issueBrowserSession(session);
    return response(200, { verified: true }, origin, { 'Set-Cookie': cookie });
  }
  if (browserRequest && !publicAccess) {
    const authenticated = request.headers.has('Authorization')
      ? await validBearer(request, env.APP_TOKEN) : await verifyBrowserSession(request, session);
    if (!authenticated) return unauthorized(origin);
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) ||
      typeof payload.question !== 'string' || !payload.question.trim()) {
    return response(400, { error: '请提供非空字符串 question。' }, origin);
  }
  if (payload.question.length > MAX_QUESTION_CHARS) {
    return response(400, { error: '问题过长，最多 2000 个字符。' }, origin);
  }
  let history = [];
  if (payload.history !== undefined && payload.history !== null) {
    if (!Array.isArray(payload.history) || payload.history.length > 40) {
      return response(400, { error: 'history 应为不超过 40 条的数组。' }, origin);
    }
    for (const item of payload.history) {
      if (!item || typeof item !== 'object' || !['user', 'assistant'].includes(item.role) ||
          typeof item.content !== 'string' || !item.content.trim() || item.content.length > 4000) {
        return response(400, { error: 'history 中每条消息需包含 role（user/assistant）和不超过 4000 字的 content。' }, origin);
      }
    }
    history = payload.history.slice(-MAX_HISTORY_ITEMS).map(item => ({ role: item.role, content: item.content.trim() }));
  }
  const shipment = payload.shipment ?? null;
  const report = payload.report ?? null;
  const useTools = payload.protocol === 2;
  if (useTools && payload.webSearch !== undefined && typeof payload.webSearch !== 'boolean') {
    return response(400, { error: 'webSearch 应为布尔值。' }, origin);
  }
  const useWeb = useTools && payload.webSearch === true;
  const logistics = useTools ? payload.logistics ?? null : null;
  if (!validContext(shipment) || !validContext(report)) {
    return response(400, { error: 'shipment 和 report 应为对象、数组、字符串或 null。' }, origin);
  }
  if (logistics !== null && (typeof logistics !== 'object' || Array.isArray(logistics))) {
    return response(400, { error: 'logistics 应为对象或 null。' }, origin);
  }
  try {
    if (contextSize(shipment) > MAX_SHIPMENT_BYTES || contextSize(report) > MAX_REPORT_BYTES ||
        contextSize(logistics) > MAX_LOGISTICS_BYTES) {
      return response(400, { error: '上下文过长，请删减货件资料或报告。' }, origin);
    }
  } catch {
    return response(400, { error: '上下文格式过于复杂，请简化后重试。' }, origin);
  }

  const secrets = [client.providerKey, env.APP_TOKEN, env.AI_SESSION_SECRET, env.ZHIPU_API_KEY, env.TAVILY_API_KEY]
    .filter(secret => typeof secret === 'string' && secret.trim());
  const hideSecrets = value => secrets.reduce((text, secret) => text.replaceAll(secret, '[已隐藏]'), value);
  const messageContext = { question: hideSecrets(payload.question.trim()), shipment, report };
  const webTools = useWeb ? createWebTools({ env, question: messageContext.question }) : [];
  if (useWeb && !webTools.length) {
    return response(503, { error: '当前 AI 服务尚未配置联网搜索。', code: 'web_search_unconfigured' }, origin);
  }
  if (logistics) {
    messageContext.logistics = { hasWorkflow: Boolean(logistics.workflow), hasQuotes: Boolean(logistics.comparison) };
  }
  const context = { ...messageContext, logistics };
  const messages = [
    { role: 'system', content: buildSystemPrompt(useTools, useWeb) },
    ...history,
    { role: 'user', content: JSON.stringify(messageContext) },
  ];
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  const signal = AbortSignal.any([controller.signal, request.signal]);
  try {
    let result;
    if (useTools) {
      result = await runAgent({
        client,
        store: createRequestSessionStore(messages),
        tools: [...createTradeTools({ origin: allowedOrigin }), ...createLogisticsTools(), ...webTools],
        context,
        signal,
      });
    } else {
      const completion = await client.complete({ messages, signal });
      result = { answer: completion.content.trim() };
      if (!result.answer) throw new Error('Empty model answer');
    }

    const answer = hideSecrets(result.answer);
    const sources = result.sources?.filter(source => !secrets.some(secret => source.url.includes(secret)))
      .map(source => ({ ...source, title: hideSecrets(source.title) }));
    return response(200, { ...result, answer, ...(sources && { sources }) }, origin);
  } catch {
    if (signal.aborted) {
      return response(504, { error: '模型服务请求超时，请稍后重试。' }, origin);
    }
    return response(502, { error: '无法取得有效的模型回答，请稍后重试或联系部署者。' }, origin);
  } finally {
    clearTimeout(timer);
  }
}

export default { fetch: handle };
