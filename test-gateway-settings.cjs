'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {GatewaySettings, normalizeHost} = require('./gateway-settings.cjs');
const {gatewayBaseUrl, gatewayConnection, DEFAULT_BASE_URL} = require('./gateway-url.cjs');
const {gatewayApiKey} = require('./gateway-credentials.cjs');
async function main() {
  assert(process.env.DSH_HOME?.includes('genai-tests-'));
  for (const [input, expected] of [
    ['',DEFAULT_BASE_URL],['  ',DEFAULT_BASE_URL],['gateway-host','http://gateway-host:8000/v1'],
    ['192.0.2.1','http://192.0.2.1:8000/v1'],['gateway-host:9000','http://gateway-host:9000/v1'],['gateway-host:80','http://gateway-host/v1'],
    ['[::1]','http://[::1]:8000/v1'],['https://gateway.invalid/proxy/','https://gateway.invalid/proxy/v1'],
    ['https://gateway.invalid/v1/','https://gateway.invalid/v1'],
  ]) assert.equal(normalizeHost(input),expected);
  for (const input of ['ftp://host','http://user:secret@host','host?token=secret','host#secret','bad host',null]) {
    assert.throws(()=>normalizeHost(input),e=>e.message==='invalidAddress');
  }
  const routes = new Map();
  let fallback = 'synthetic-fallback-key-'.repeat(3);
  let record;
  const credentials = {resolve:async()=>({value:fallback}),readRecord:async()=>structuredClone(record),modifyRecord:async(_id,fn)=>{record=await fn(structuredClone(record));}};
  const host = {capabilityCache:{old:true},ctx:{credentials,effect:f=>f(),connection:{fetch:{register:r=>{routes.set(r.path,r);return()=>{};}}}}};
  const settings = new GatewaySettings(host); settings.install();
  async function rpc(action,payload) {
    const method = 'shanghaitech.gateway.'+action;
    const response = await routes.get('/api/'+method).fetch(new Request('http://local/api/'+method,{method:'POST',body:JSON.stringify({type:'client-request',rpcId:'test',method,payload})}));
    return (await response.json()).result;
  }
  const initial = await rpc('get',{});
  assert.equal(initial.value.baseUrl,DEFAULT_BASE_URL);
  assert.equal(initial.value.keyConfigured,true);
  assert.equal(initial.value.apiKey,fallback);
  for (const [payload,code] of [
    [{address:'ftp://host',apiKey:'',revision:'inherited'},'invalidAddress'],
    [{address:'',apiKey:'short',revision:'inherited'},'invalidKey'],
    [{address:'',apiKey:'a'.repeat(32)+'\nb',revision:'inherited'},'invalidKey'],
    [{address:'',apiKey:'',revision:'stale'},'settingsChanged'],
    [{address:'',apiKey:'',revision:'inherited',other:true},'invalidSettings'],
  ]) assert.equal((await rpc('set',payload)).error.code,code);
  assert.equal(record,undefined);
  fallback = undefined;
  assert.equal((await rpc('set',{address:'',apiKey:'',revision:'inherited'})).error.code,'keyRequired');
  const key = 'synthetic-ui-key-'.repeat(3);
  const first = await rpc('set',{address:'gateway-host:9000',apiKey:key,revision:'inherited'});
  assert.equal(first.ok,true);
  assert.equal(first.value.apiKey,key);
  assert.equal(host.capabilityCache,null);
  assert.equal(gatewayBaseUrl(await gatewayConnection(credentials)),'http://gateway-host:9000/v1');
  assert.equal(await gatewayApiKey(credentials),key);
  assert.equal(record.kind,'grant');
  // A newly constructed host reads durable settings; saved values win over deployment and launcher settings.
  const privateDir = path.join(process.env.DSH_HOME,'original-private'); fs.mkdirSync(privateDir);
  const originalConfig = JSON.stringify({base_url:'https://original.invalid',key_file:'gateway.key'});
  fs.writeFileSync(path.join(privateDir,'dsh-gateway.json'),originalConfig);
  fs.writeFileSync(path.join(privateDir,'gateway.key'),'synthetic-original-'.repeat(3));
  fs.writeFileSync(path.join(process.env.DSH_HOME,'shanghaitech-genai.json'),JSON.stringify({private_dir:privateDir}));
  assert.equal((await new GatewaySettings(host).get()).baseUrl,first.value.baseUrl);
  assert.equal(gatewayBaseUrl(await gatewayConnection(credentials)),first.value.baseUrl);
  const local = await rpc('set',{address:'',apiKey:'',revision:first.value.revision});
  assert.equal(local.ok,true); assert.equal(gatewayBaseUrl(await gatewayConnection(credentials)),DEFAULT_BASE_URL);
  assert.equal(await gatewayApiKey(credentials),key);
  assert.equal(fs.readFileSync(path.join(privateDir,'dsh-gateway.json'),'utf8'),originalConfig);
  assert.equal((await rpc('set',{address:'new-host',apiKey:'',revision:first.value.revision})).error.code,'settingsChanged');
  const inFlight = await gatewayConnection(credentials);
  const rotated = 'synthetic-rotated-key-'.repeat(3);
  assert.equal((await rpc('set',{address:'',apiKey:rotated,revision:local.value.revision})).ok,true);
  assert.equal(await gatewayApiKey(credentials),rotated);
  assert.equal(await gatewayApiKey(credentials,inFlight),key,'In-flight requests keep their original key');
  assert.equal(gatewayBaseUrl(inFlight),DEFAULT_BASE_URL);
  assert.equal((await rpc('get',{})).value.apiKey,rotated);
  record={kind:'grant',payload:{apiKey:rotated}};
  const broken = await rpc('get',{});
  assert.equal(broken.error.code,'settingsUnavailable');
  console.log('PASS: native settings RPC, address normalization, effective-key reads, key rotation, native credential persistence, local default, original config preservation, validation and stale-write rejection.');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
