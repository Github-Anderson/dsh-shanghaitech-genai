'use strict';
const CREDENTIAL = 'SHANGHAITECH_GENAI_API_KEY';
// Resolve through DSH only.
async function gatewayApiKey(credentials) {
  const record = await credentials.resolve(CREDENTIAL);
  const key = record?.value;
  if (typeof key !== 'string' || !key || /[^\x21-\x7e]/.test(key)) {
    const error = Error('Configure SHANGHAITECH_GENAI_API_KEY in DSH credentials.');
    error.code = 'shanghaitech/credential-required';
    throw error;
  }
  return key;
}
module.exports = {gatewayApiKey, CREDENTIAL};
