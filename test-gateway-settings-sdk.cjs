'use strict';
// Electron-as-Node, with test-environment.cjs. Only synthetic credentials; no network.
const assert=require('node:assert/strict'),path=require('node:path');
const {createRequire}=require('node:module');
const sdk=createRequire(path.join(process.env.DSH_TEST_SDK_ROOT,'package.json'));
const {Context}=sdk('@deepseek-ai/cordis');
const {LocalCredentialProvider}=sdk('@deepseek-ai/dsh-credentials-local');
const {GatewaySettings}=require('./gateway-settings.cjs');
const {OptionsHost}=require('./host.cjs');
const {CREDENTIAL}=require('./gateway-credentials.cjs');
const {gatewayConnection}=require('./gateway-url.cjs');
async function main(){
 assert(process.env.DSH_HOME?.includes('genai-tests-'));
 const root=new Context(),other=new Context();
 try{
  await root.plugin(LocalCredentialProvider,{watch:false,dshHome:process.env.DSH_HOME,path:path.join(process.env.DSH_HOME,'.credentials.yaml')}).await();
  const credentials=root.credentials;
  await credentials.set(CREDENTIAL,'synthetic-dsh-reference-'.repeat(2));
  const host=new OptionsHost({credentials},()=>{}),settings=new GatewaySettings(host);
  const before=await settings.get();assert.equal('Bearer '+before.apiKey,(await host.headers()).Authorization);
  const saved=await settings.set({address:'gateway.invalid:8123',apiKey:'synthetic-native-record-'.repeat(2),revision:before.revision});
  await other.plugin(LocalCredentialProvider,{watch:false,dshHome:process.env.DSH_HOME,path:path.join(process.env.DSH_HOME,'.credentials.yaml')}).await();
  const reopened=other.credentials;
  const restored=await gatewayConnection(reopened);assert.equal(restored.apiKey,saved.apiKey);assert.equal(restored.baseUrl,'http://gateway.invalid:8123/v1');
  await credentials.set(CREDENTIAL,'synthetic-unused-reference-'.repeat(2));
  assert.equal((await settings.get()).apiKey,saved.apiKey);assert.equal((await host.headers()).Authorization,'Bearer '+saved.apiKey);
  await assert.rejects(settings.set({address:'',apiKey:'',revision:before.revision}),/settingsChanged/);
  console.log('PASS: real DSH credential reference, atomic native record, restart persistence, request/display identity and stale revision rejection.');
 }finally{await root.fiber.dispose();await other.fiber.dispose();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
