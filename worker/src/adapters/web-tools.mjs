import { limitResponseBody } from './response-body.mjs';

const BIGMODEL_BASE = 'https://open.bigmodel.cn/api/paas/v4';
const TAVILY_BASE = 'https://api.tavily.com';
const MAX_SEARCH_RESULTS = 5;
const MAX_EXPLICIT_URLS = 2;
const MAX_READS = 2;
const MAX_URL_LENGTH = 500;
const MAX_QUERY_LENGTH = 70;
const SEARCH_TIMEOUT_MS = 5_000;
const READ_TIMEOUT_SECONDS = 6;
const MAX_RESPONSE_BYTES = 512 * 1024;
const WEB_URL = /(?:\b[a-z][a-z0-9+.-]*:\/\/|\bwww\.)[^\s<>"'`，。？！：；、（）【】《》“”‘’]+/giu;
const PUBLIC_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;
const NON_PUBLIC_TLDS = new Set(['arpa', 'cluster', 'corp', 'example', 'home', 'internal', 'intranet', 'invalid', 'lan', 'local', 'localdomain', 'localhost', 'onion', 'private', 'test']);
const PRIVATE_HOSTS = ['sslip.io', 'nip.io', 'xip.io', 'traefik.me', 'localtest.me', 'lvh.me'];
const PRIVATE_PARAMETER = /^(?:authorization|(?:access|auth|oauth|refresh|id|session|api)?token|(?:api|private|access)?key|auth|(?:user)?password|passwd|secret|credential|signature|sig|session(?:id)?|sid|jwt|xamz.*|xgoog.*|xms.*)$/i;
const NO_PARAMETERS = { type: 'object', properties: {}, required: [], additionalProperties: false };

function apiKey(value) {
  return typeof value === 'string' && /^[\x21-\x7e]{1,1024}$/.test(value) ? value : '';
}

function bigModelKey(env) {
  const explicit = apiKey(env.ZHIPU_API_KEY);
  if (explicit) return explicit;
  if (env.AI_PROVIDER && env.AI_PROVIDER !== 'zhipu') return '';
  const base = env.ZHIPU_BASE_URL || env.OPENAI_BASE_URL || BIGMODEL_BASE;
  return typeof base === 'string' && base.replace(/\/+$/, '') === BIGMODEL_BASE
    ? apiKey(env.OPENAI_API_KEY) : '';
}

function webProvider(env) {
  const tavily = apiKey(env.TAVILY_API_KEY);
  if (tavily) return { kind: 'tavily', key: tavily };
  const zhipu = bigModelKey(env);
  return zhipu ? { kind: 'zhipu', key: zhipu } : null;
}

function confidentialValues(env) {
  const values = [env.APP_TOKEN, env.AI_SESSION_SECRET, env.ZHIPU_API_KEY,
    env.OPENAI_API_KEY, env.ANTHROPIC_API_KEY, env.TAVILY_API_KEY].map(apiKey).filter(Boolean);
  return [...new Set(values.flatMap(value => [value, encodeURIComponent(value)]))].sort((left, right) => right.length - left.length);
}

function redact(value, secrets) {
  return secrets.reduce((text, secret) => text.replaceAll(secret, ' '), typeof value === 'string' ? value : '');
}

function compact(value, limit) {
  return (typeof value === 'string' ? value : '').replace(/[\p{Cc}\p{Cf}\uD800-\uDFFF]+/gu, ' ')
    .replace(/\s+/gu, ' ').trim().slice(0, limit).replace(/[\uD800-\uDBFF]$/, '').trimEnd();
}

function publicUrl(value, secrets) {
  if (typeof value !== 'string' || value.length > MAX_URL_LENGTH || !/^https:\/\//i.test(value) ||
      /[\\\s\p{Cc}\p{Cf}]/u.test(value) || secrets.some(secret => value.includes(secret))) return '';
  try {
    const url = new URL(value);
    const host = url.hostname;
    const labels = host.split('.');
    const tld = labels.at(-1);
    if (url.protocol !== 'https:' || url.username || url.password || url.port ||
        host.length > 253 || labels.length < 2 || !labels.every(label => PUBLIC_LABEL.test(label)) ||
        !/^[a-z]/i.test(tld) || NON_PUBLIC_TLDS.has(tld) ||
        PRIVATE_HOSTS.some(domain => host === domain || host.endsWith('.' + domain))) return '';
    if ([...url.searchParams.keys()].some(key => PRIVATE_PARAMETER.test(key.replace(/[^a-z0-9]/gi, '')))) return '';
    url.hash = '';
    return url.href.length <= MAX_URL_LENGTH ? url.href : '';
  } catch {
    return '';
  }
}

function trimLink(url) {
  const clean = url.replace(/[.,!?;:]+$/, '');
  for (const [open, close] of [['(', ')'], ['[', ']'], ['{', '}']]) {
    if (clean.endsWith(close) && clean.split(close).length > clean.split(open).length) {
      return trimLink(clean.slice(0, -1));
    }
  }
  return clean;
}

function explicitUrls(question, secrets) {
  const urls = [...question.matchAll(WEB_URL)].map(([url]) => publicUrl(trimLink(url), secrets)).filter(Boolean);
  return [...new Set(urls)].slice(0, MAX_EXPLICIT_URLS);
}

function userQuery(question, secrets) {
  const noLinks = question.replace(WEB_URL, ' ');
  const noCredentials = redact(noLinks, secrets)
    .replace(/\bBearer\s+[!-~]+/gi, ' ')
    .replace(/[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.[\p{L}]{2,}/gu, ' ');
  const query = compact(noCredentials, MAX_QUERY_LENGTH);
  return /[\p{L}\p{N}]/u.test(query) ? query : '';
}

function publishedAt(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}(?:T[0-9:.]+(?:Z|[+-][0-9:]+))?$/.test(value)) return undefined;
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return undefined;
  if (value.length === 10 && !parsed.toISOString().startsWith(value)) return undefined;
  return parsed.toISOString();
}

async function postJson(fetchImpl, url, key, body, signal, timeout) {
  const deadline = AbortSignal.timeout(timeout);
  const requestSignal = signal ? AbortSignal.any([signal, deadline]) : deadline;
  requestSignal.throwIfAborted();
  const response = await fetchImpl(url, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
    body: JSON.stringify(body),
    credentials: 'omit',
    redirect: 'manual',
    signal: requestSignal,
  });
  if (!response.ok) {
    void response.body?.cancel().catch(() => {});
    throw new Error('Web provider did not return a successful response');
  }
  return limitResponseBody(response, MAX_RESPONSE_BYTES).json();
}

async function searchWeb(provider, fetchImpl, query, signal) {
  if (provider.kind === 'tavily') {
    const result = await postJson(fetchImpl, TAVILY_BASE + '/search', provider.key, {
      query, max_results: MAX_SEARCH_RESULTS, search_depth: 'basic', include_published_date: true,
    }, signal, SEARCH_TIMEOUT_MS);
    if (!Array.isArray(result?.results)) throw new Error('Invalid search response');
    return result.results.slice(0, 25).map(item => ({
      title: item?.title, url: item?.url, snippet: item?.content, publishedAt: item?.published_date,
    }));
  }

  const result = await postJson(fetchImpl, BIGMODEL_BASE + '/web_search', provider.key, {
    search_query: query, search_engine: 'search_std', search_intent: false, count: MAX_SEARCH_RESULTS,
  }, signal, SEARCH_TIMEOUT_MS);
  if (!Array.isArray(result?.search_result)) throw new Error('Invalid search response');
  return result.search_result.slice(0, 25).map(item => ({
    title: item?.title, url: item?.link, snippet: item?.content, publishedAt: item?.publish_date,
  }));
}

async function readWebPage(provider, fetchImpl, url, signal) {
  const requestTimeout = READ_TIMEOUT_SECONDS * 1_000 + 1_000;
  if (provider.kind === 'tavily') {
    const payload = await postJson(fetchImpl, TAVILY_BASE + '/extract', provider.key, {
      urls: [url], extract_depth: 'basic', format: 'text', timeout: READ_TIMEOUT_SECONDS, include_published_date: true,
    }, signal, requestTimeout);
    const page = Array.isArray(payload?.results) ? payload.results[0] : null;
    return { url: page?.url, title: page?.title, text: page?.raw_content, publishedAt: page?.published_date };
  }

  const payload = await postJson(fetchImpl, BIGMODEL_BASE + '/reader', provider.key, {
    url, timeout: READ_TIMEOUT_SECONDS, return_format: 'text', retain_images: false,
  }, signal, requestTimeout);
  const page = payload?.reader_result;
  return { url: page?.url, title: page?.title, text: page?.content };
}

export function createWebTools({ env = {}, question = '', fetchImpl = globalThis.fetch } = {}) {
  const provider = webProvider(env);
  if (!provider) return [];
  const currentQuestion = typeof question === 'string' ? question.slice(0, 2_000) : '';
  const secrets = confidentialValues(env);
  const query = userQuery(currentQuestion, secrets);
  const entries = new Map();
  const ids = new Map();
  let searched = false;
  const reads = new Set();

  function addEntry(url, title, published) {
    const id = ids.get(url) || 'w' + (ids.size + 1);
    ids.set(url, id);
    const entry = { id, title, url, ...(published && { publishedAt: published }) };
    entries.set(id, entry);
    return entry;
  }

  const explicit = explicitUrls(currentQuestion, secrets).map(url => {
    const entry = addEntry(url, new URL(url).hostname);
    return { sourceId: entry.id, url };
  });
  const explicitNote = explicit.length ? ' 本轮用户给出的可读链接按顺序编号为 ' + explicit.map(item => item.sourceId).join('、') + '。' : '';

  return [
    {
      name: 'web_search',
      description: '搜索本轮用户问题中的公开内容。返回带编号的标题、链接和摘要，正文请用 read_page。' + explicitNote,
      parameters: NO_PARAMETERS,
      async execute(_args, _context, signal) {
        if (searched) return { status: 'unavailable', data: { note: '本轮搜索次数已用完。' }, sources: [] };
        searched = true;
        if (!query) return { status: 'needs_input', data: { explicit, note: '本轮问题中没有可搜索的公开关键词。' }, sources: [] };

        try {
          const candidates = await searchWeb(provider, fetchImpl, query, signal);
          const retrievedAt = new Date().toISOString();
          const sources = [];
          const matches = [];
          const seen = new Set();
          for (const result of candidates) {
            const url = publicUrl(result.url, secrets);
            if (!url || seen.has(url)) continue;
            const title = compact(redact(result.title, secrets), 120) || new URL(url).hostname;
            const published = publishedAt(result.publishedAt);
            const entry = addEntry(url, title, published);
            matches.push({ sourceId: entry.id, snippet: compact(redact(result.snippet, secrets), 80), ...(published && { publishedAt: published }) });
            sources.push({ ...entry, kind: 'reference', method: 'search', retrievedAt });
            seen.add(url);
            if (sources.length >= MAX_SEARCH_RESULTS) break;
          }
          return { status: 'ok', data: { matches, explicit }, sources };
        } catch {
          signal?.throwIfAborted();
          return { status: 'unavailable', data: { explicit, note: '搜索服务暂不可用。' }, sources: [] };
        }
      },
    },
    {
      name: 'read_page',
      description: '读取本轮搜索结果或用户公开链接的正文，只接受当前轮的来源编号。' + explicitNote,
      parameters: {
        type: 'object',
        properties: { sourceId: { type: 'string', pattern: '^w[1-7]$' } },
        required: ['sourceId'],
        additionalProperties: false,
      },
      review: ({ sourceId }) => entries.has(sourceId),
      async execute({ sourceId }, _context, signal) {
        const entry = entries.get(sourceId);
        if (!entry) return { status: 'needs_input', data: { note: '请选择本轮搜索结果或用户链接的编号。' }, sources: [] };
        if (reads.size >= MAX_READS || reads.has(sourceId)) {
          return { status: 'unavailable', data: { sourceId, note: '本轮读页次数已用完或该来源已请求过。' }, sources: [] };
        }
        reads.add(sourceId);

        try {
          const page = await readWebPage(provider, fetchImpl, entry.url, signal);
          const url = publicUrl(page.url, secrets);
          const text = compact(redact(page.text, secrets), 1_300);
          if (!url || !text) throw new Error('No usable public page content');
          const published = publishedAt(page.publishedAt) ?? entry.publishedAt;
          const title = compact(redact(page.title, secrets), 120) || entry.title;
          const source = {
            id: entry.id, title, url, kind: 'lookup', method: 'page', retrievedAt: new Date().toISOString(),
            ...(published && { publishedAt: published }),
          };
          return { status: 'ok', data: { sourceId, text, ...(published && { publishedAt: published }) }, sources: [source] };
        } catch {
          signal?.throwIfAborted();
          return { status: 'unavailable', data: { sourceId, note: '未能读取该网页的正文。' }, sources: [] };
        }
      },
    },
  ];
}
