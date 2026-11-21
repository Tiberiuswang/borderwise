const SESSION_KEY = 'borderwise-agent-session-v1';
const MAX_TURNS = 12;
const MAX_QUESTION_LENGTH = 2000;
const MAX_ANSWER_LENGTH = 16_000;
const MAX_HISTORY_CONTENT_LENGTH = 4000;
const MAX_HISTORY_MESSAGES = 8;
const MAX_HISTORY_BYTES = 3 * 1024;
const MAX_STORED_LENGTH = 800 * 1024;
const encoder = new TextEncoder();
const serializedBytes = value => encoder.encode(JSON.stringify(value)).length;

function browserStorage() {
  try {
    return globalThis.sessionStorage ?? null;
  } catch {
    return null;
  }
}

function boundedText(value, limit) {
  return typeof value === 'string' ? value.trim().slice(0, limit).replace(/[\uD800-\uDBFF]$/, '').trimEnd() : '';
}

function parseUrl(value) {
  if (typeof value !== 'string' || value.length > 500) return null;
  try {
    const url = new URL(value);
    return url.username || url.password ? null : url;
  } catch {
    return null;
  }
}

function endpointScope(value) {
  const url = parseUrl(value);
  if (!url || url.search || url.hash) return '';
  const localhost = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  return url.protocol === 'https:' || (url.protocol === 'http:' && localhost) ? url.href : '';
}

function normalizeStep(step) {
  const name = boundedText(step?.name, 64);
  const status = boundedText(step?.status, 32);
  return name && status ? { name, status } : null;
}

function normalizeSource(source) {
  const url = parseUrl(source?.url);
  const title = boundedText(source?.title, 160);
  const kind = source?.kind;
  if (!title || url?.protocol !== 'https:' || (kind !== 'lookup' && kind !== 'reference')) return null;
  const retrievedAt = boundedText(source.retrievedAt, 40);
  return {
    title,
    url: url.href,
    kind,
    ...(retrievedAt && Number.isFinite(Date.parse(retrievedAt)) ? { retrievedAt } : {}),
  };
}

function normalizeTurn(turn) {
  const question = boundedText(turn?.question, MAX_QUESTION_LENGTH);
  const answer = boundedText(turn?.answer, MAX_ANSWER_LENGTH);
  const mode = turn?.mode;
  if (!question || !answer || (mode !== 'local' && mode !== 'ai')) return null;
  const scope = mode === 'ai' ? endpointScope(turn.scope) : '';
  const steps = Array.isArray(turn.steps) ? turn.steps.slice(0, 12).map(normalizeStep).filter(Boolean) : [];
  const sources = Array.isArray(turn.sources) ? turn.sources.slice(0, 8).map(normalizeSource).filter(Boolean) : [];
  return {
    question, answer, mode,
    ...(scope ? { scope } : {}),
    ...(steps.length ? { steps } : {}),
    ...(sources.length ? { sources } : {}),
  };
}

function readTurns(storage) {
  try {
    const raw = storage?.getItem(SESSION_KEY);
    if (!raw || raw.length > MAX_STORED_LENGTH) return [];
    const saved = JSON.parse(raw);
    if (saved?.version !== 1 || !Array.isArray(saved.turns)) return [];
    return saved.turns.slice(-MAX_TURNS).map(normalizeTurn).filter(Boolean);
  } catch {
    return [];
  }
}

function historyExcerpt(content, limit) {
  if (serializedBytes(content) <= limit) return content;
  let start = 1;
  let end = content.length - 1;
  let excerpt = '…';
  while (start <= end) {
    const length = Math.floor((start + end) / 2);
    const candidate = boundedText(content, length) + '…';
    if (serializedBytes(candidate) <= limit) {
      excerpt = candidate;
      start = length + 1;
    } else {
      end = length - 1;
    }
  }
  return excerpt;
}

export function createSessionStore(storage = browserStorage()) {
  let turns = readTurns(storage);

  function persist() {
    try {
      storage?.setItem(SESSION_KEY, JSON.stringify({ version: 1, turns }));
      return true;
    } catch {
      return false;
    }
  }

  return {
    turns() {
      return structuredClone(turns);
    },
    history(scope) {
      const endpoint = endpointScope(scope);
      if (!endpoint) return [];
      let messages = [];
      for (let index = turns.length - 1; index >= 0 && messages.length < MAX_HISTORY_MESSAGES; index--) {
        const turn = turns[index];
        if (turn.scope !== endpoint) continue;
        const next = [
          { role: 'user', content: turn.question },
          { role: 'assistant', content: boundedText(turn.answer, MAX_HISTORY_CONTENT_LENGTH) },
          ...messages,
        ];
        // Reserve space for the current question, shipment and report in the Worker request.
        if (serializedBytes(next) > MAX_HISTORY_BYTES) {
          if (messages.length) break;
          // Keep the newest exchange, shortening each message without splitting the pair.
          const contentBudget = (MAX_HISTORY_BYTES - 128) / 2;
          return next.map(message => ({ ...message, content: historyExcerpt(message.content, contentBudget) }));
        }
        messages = next;
      }
      return messages;
    },
    append(turn) {
      const normalized = normalizeTurn(turn);
      if (!normalized) return false;
      turns = [...turns.slice(1 - MAX_TURNS), normalized];
      persist();
      return true;
    },
    clear() {
      turns = [];
      try {
        storage?.removeItem(SESSION_KEY);
        return true;
      } catch {
        return persist();
      }
    },
  };
}
