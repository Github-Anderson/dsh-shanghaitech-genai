'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {gatewayBaseUrl, DEFAULT_BASE_URL} = require('./gateway-url.cjs');
const {gatewayApiKey} = require('./gateway-credentials.cjs');
async function main() {
  const root = process.env.DSH_HOME;
  assert(root && root.includes('genai-tests-'), 'Run with test-environment.cjs');
  const privateDir = path.join(root, 'private');
  fs.mkdirSync(privateDir);
  fs.writeFileSync(path.join(root, 'shanghaitech-genai.json'), JSON.stringify({private_dir:privateDir}));
  const config = path.join(privateDir, 'dsh-gateway.json');
  const local = 'local-synthetic-'.repeat(3), remote = 'remote-synthetic-'.repeat(3);
  fs.writeFileSync(path.join(privateDir, 'gateway.key'), local);
  fs.writeFileSync(path.join(privateDir, 'remote.key'), remote);
  const credentials = {resolve:async()=>{throw Error('DSH store should not be used');}};
  assert.equal(gatewayBaseUrl(), DEFAULT_BASE_URL);
  assert.equal(await gatewayApiKey(credentials), local);
  for (const base_url of ['', '  ', null]) {
    fs.writeFileSync(config, JSON.stringify({base_url,key_file:'remote.key'}));
    assert.equal(gatewayBaseUrl(), DEFAULT_BASE_URL);
    assert.equal(await gatewayApiKey(credentials), local);
  }
  fs.writeFileSync(config, JSON.stringify({base_url:'https://example.invalid/proxy',key_file:'remote.key'}));
  assert.equal(gatewayBaseUrl(), 'https://example.invalid/proxy/v1');
  assert.equal(await gatewayApiKey(credentials), remote);
  // Registered configuration also wins over a stale launcher environment.
  assert.equal(gatewayBaseUrl({...process.env,SHANGHAITECH_GENAI_BASE_URL:DEFAULT_BASE_URL}), 'https://example.invalid/proxy/v1');
  fs.unlinkSync(path.join(privateDir, 'remote.key'));
  await assert.rejects(gatewayApiKey(credentials), /key file/);
  for (const entry of [{base_url:'https://user:synthetic-secret@example.invalid',key_file:'remote.key'}, {base_url:'https://example.invalid',key_file:'../outside.key'}, {base_url:'https://example.invalid'}]) {
    fs.writeFileSync(config, JSON.stringify(entry));
    assert.throws(()=>gatewayBaseUrl(), e=>!e.message.includes('synthetic-secret') && /Invalid private/.test(e.message));
  }
  fs.writeFileSync(config, '{');
  assert.throws(()=>gatewayBaseUrl(), /Invalid private/);
  console.log('PASS: direct-launch private configuration, local default, paired keys, stale environment, missing-key and invalid-config failures.');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
