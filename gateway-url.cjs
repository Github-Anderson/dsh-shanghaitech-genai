'use strict';
const DEFAULT_BASE_URL = 'http://127.0.0.1:8000/v1';

function normalizeBaseUrl(value) {
  let url;
  try {
    if (typeof value !== 'string' || !value.trim()) throw Error();
    url = new URL(value.trim());
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw Error();
  } catch {
    throw Error('Gateway address must be an HTTP(S) URL without credentials, query or fragment.');
  }
  let pathname = url.pathname.replace(/\/+$/, '');
  if (!pathname.endsWith('/v1')) pathname += '/v1';
  url.pathname = pathname;
  return url.toString().replace(/\/$/, '');
}

// Addresses and keys are resolved together from DSH's credential provider.
async function gatewayConnection(credentials) {
  return require('./gateway-credentials.cjs').resolveConnection(credentials);
}
function gatewayBaseUrl(connection) {
  return connection?.baseUrl ?? DEFAULT_BASE_URL;
}
module.exports = {gatewayBaseUrl, gatewayConnection, normalizeBaseUrl, DEFAULT_BASE_URL};
