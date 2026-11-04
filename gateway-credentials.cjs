'use strict';
const CREDENTIAL = 'SHANGHAITECH_GENAI_API_KEY';
const fs = require('node:fs');
const {gatewayConnection} = require('./gateway-url.cjs');
async function gatewayApiKey(credentials) {
  const connection = gatewayConnection();
  let key;
  if (connection) {
    try {
      key = fs.readFileSync(connection.keyFile, 'utf8').replace(/^\uFEFF/, '').trim();
      if (key.length < 32 || key.length > 4096) throw Error();
    } catch {
      throw Error('Cannot read the configured private gateway key file.');
    }
  } else {
    key = (await credentials.resolve(CREDENTIAL))?.value;
  }
  if (typeof key !== 'string' || !key || /[^\x21-\x7e]/.test(key)) {
    const error = Error('Configure SHANGHAITECH_GENAI_API_KEY in DSH credentials.');
    error.code = 'shanghaitech/credential-required';
    throw error;
  }
  return key;
}
module.exports = {gatewayApiKey, CREDENTIAL};
