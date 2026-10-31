'use strict';
const DEFAULT_BASE_URL = 'http://127.0.0.1:8000/v1';

// Host-side only: shared by capabilities, chat, native uploads and PDF tools.
function gatewayBaseUrl(env = process.env) {
  const value = env.SHANGHAITECH_GENAI_BASE_URL;
  if (value === undefined) return DEFAULT_BASE_URL;
  let url;
  try {
    if (typeof value !== 'string' || !value.trim()) throw Error();
    url = new URL(value.trim());
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw Error();
  } catch {
    // Never echo a possibly credential-bearing URL.
    throw Error('SHANGHAITECH_GENAI_BASE_URL must be an HTTP(S) URL without credentials, query or fragment.');
  }
  let pathname = url.pathname.replace(/\/+$/, '');
  if (!pathname.endsWith('/v1')) pathname += '/v1';
  url.pathname = pathname;
  return url.toString().replace(/\/$/, '');
}
module.exports = {gatewayBaseUrl, DEFAULT_BASE_URL};
