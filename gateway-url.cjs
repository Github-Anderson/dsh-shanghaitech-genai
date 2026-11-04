'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
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

// Only the host reads private configuration. The registration contains a directory, never a key.
function gatewayConnection(env = process.env) {
  const registration = path.join(env.DSH_HOME || path.join(os.homedir(), '.dsh'), 'shanghaitech-genai.json');
  let directory;
  try {
    directory = JSON.parse(fs.readFileSync(registration, 'utf8')).private_dir;
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw Error('Cannot read ShanghaiTech GenAI private-directory registration.');
  }
  try {
    if (typeof directory !== 'string' || !path.isAbsolute(directory)) throw Error();
    let config = {};
    try { config = JSON.parse(fs.readFileSync(path.join(directory, 'dsh-gateway.json'), 'utf8').replace(/^\uFEFF/, '')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (!config || Array.isArray(config) || typeof config !== 'object') throw Error();
    const address = config.base_url;
    if (address != null && typeof address !== 'string') throw Error();
    const remote = Boolean(address?.trim());
    const name = remote ? config.key_file : 'gateway.key';
    if (typeof name !== 'string' || !name || path.isAbsolute(name) || name.split(/[\\/]/).some(p => p === '..' || !p)) throw Error();
    return {baseUrl: remote ? normalizeBaseUrl(address) : DEFAULT_BASE_URL, keyFile: path.join(directory, name)};
  } catch {
    throw Error('Invalid private/dsh-gateway.json: check base_url and key_file.');
  }
}

function gatewayBaseUrl(env = process.env) {
  const connection = gatewayConnection(env);
  if (connection) return connection.baseUrl;
  return env.SHANGHAITECH_GENAI_BASE_URL === undefined ? DEFAULT_BASE_URL : normalizeBaseUrl(env.SHANGHAITECH_GENAI_BASE_URL);
}
module.exports = {gatewayBaseUrl, gatewayConnection, normalizeBaseUrl, DEFAULT_BASE_URL};
