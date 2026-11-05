'use strict';
const CREDENTIAL = 'SHANGHAITECH_GENAI_API_KEY';
const CONNECTION_RECORD = 'dsh-shanghaitech-genai/gateway';
const {normalizeBaseUrl, DEFAULT_BASE_URL} = require('./gateway-url.cjs');
function connectionFromRecord(record) {
  if (record === undefined) return null;
  const value = record?.payload;
  if (record.kind !== 'grant' || !value || typeof value.apiKey !== 'string' ||
      typeof value.revision !== 'string') throw Error('Invalid DSH gateway credential record.');
  return {baseUrl:normalizeBaseUrl(value.baseUrl), apiKey:value.apiKey, revision:value.revision};
}
async function resolveConnection(credentials) {
  const saved = connectionFromRecord(await credentials?.readRecord?.(CONNECTION_RECORD));
  if (saved) return saved;
  const value = await credentials?.resolve?.(CREDENTIAL);
  return {baseUrl:DEFAULT_BASE_URL, apiKey:value?.value ?? '', revision:'inherited'};
}
async function gatewayApiKey(credentials, connection) {
  const key = (connection ?? await resolveConnection(credentials)).apiKey;
  if (typeof key !== 'string' || !key || /[^\x21-\x7e]/.test(key)) {
    const error = Error('Configure SHANGHAITECH_GENAI_API_KEY in DSH credentials.');
    error.code = 'shanghaitech/credential-required';
    throw error;
  }
  return key;
}
module.exports = {gatewayApiKey, resolveConnection, connectionFromRecord, CREDENTIAL, CONNECTION_RECORD};
