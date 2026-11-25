const COOKIE_NAME = '__Host-borderwise-ai';
const COOKIE_ATTRIBUTES = 'Path=/; Secure; HttpOnly; SameSite=Strict';
const SESSION_ROUTE = '/api/ai';
const SESSION_MAX_AGE = 30 * 24 * 60 * 60;
const MAX_COOKIE_HEADER = 8 * 1024;
const SESSION_TOKEN = /^(v1\.([1-9][0-9]{0,11})\.[A-Za-z0-9_-]{22})\.([A-Za-z0-9_-]{43})$/;
const encoder = new TextEncoder();

export function isBrowserSessionRequest(request, origin) {
  return typeof origin === 'string' && origin.startsWith('https://') &&
    request.method === 'POST' && request.headers.get('Origin') === origin &&
    request.url === origin + SESSION_ROUTE;
}

function toBase64Url(bytes) {
  return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function fromBase64Url(text) {
  const bytes = Uint8Array.from(atob(text.replaceAll('-', '+').replaceAll('_', '/')), char => char.charCodeAt(0));
  return toBase64Url(bytes) === text ? bytes : null;
}

function signingKey(secret) {
  return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

function signedMessage({ origin, appToken }, tokenParts) {
  return encoder.encode(JSON.stringify([COOKIE_NAME, origin, SESSION_ROUTE, appToken, tokenParts]));
}

function credentialsConfigured({ appToken, secret }) {
  return typeof appToken === 'string' && Boolean(appToken) && typeof secret === 'string' && Boolean(secret);
}

function cookieToken(header) {
  if (!header || header.length > MAX_COOKIE_HEADER) return '';
  const pairPrefix = COOKIE_NAME + '=';
  const cookies = header.split(';').map(cookie => cookie.trim()).filter(cookie => cookie.startsWith(pairPrefix));
  return cookies.length === 1 ? cookies[0].slice(pairPrefix.length) : '';
}

export async function issueBrowserSession(config, now = Date.now()) {
  const expires = Math.floor(now / 1000) + SESSION_MAX_AGE;
  const nonce = toBase64Url(crypto.getRandomValues(new Uint8Array(16)));
  const tokenParts = 'v1.' + expires + '.' + nonce;
  const key = await signingKey(config.secret);
  const signature = await crypto.subtle.sign('HMAC', key, signedMessage(config, tokenParts));
  const token = tokenParts + '.' + toBase64Url(new Uint8Array(signature));
  return COOKIE_NAME + '=' + token + '; ' + COOKIE_ATTRIBUTES + '; Max-Age=' + SESSION_MAX_AGE;
}

export async function verifyBrowserSession(request, config, now = Date.now()) {
  if (!isBrowserSessionRequest(request, config.origin) || !credentialsConfigured(config)) return false;
  const token = cookieToken(request.headers.get('Cookie'));
  const match = SESSION_TOKEN.exec(token);
  if (!match) return false;

  const [, tokenParts, expiry, signature] = match;
  const expires = Number(expiry);
  const current = Math.floor(now / 1000);
  if (expires <= current || expires > current + SESSION_MAX_AGE) return false;

  const signatureBytes = fromBase64Url(signature);
  if (!signatureBytes) return false;
  const key = await signingKey(config.secret);
  return crypto.subtle.verify('HMAC', key, signatureBytes, signedMessage(config, tokenParts));
}

export function expireBrowserSession() {
  return COOKIE_NAME + '=; ' + COOKIE_ATTRIBUTES + '; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT';
}
