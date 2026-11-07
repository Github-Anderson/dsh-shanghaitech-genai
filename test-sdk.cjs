'use strict';
// Run with Electron-as-Node; argument points at this installed DSH's bundled @deepseek-ai directory.
const assert=require('node:assert/strict');
const path=require('node:path');
const root=process.argv[2];
if(!root)throw Error('Pass the installed DSH SDK directory.');
const manifest=require('./package.json');
const sdkVersion=require(path.join(root,'dsh-llm','package.json')).version;
assert.equal(manifest.engines.dsh,'>=0.2.1-rc.2');
for(const name of ['dsh-llm','dsh-session']) {
  const installed=require(path.join(root,name,'package.json')).version;
  assert.equal(installed,sdkVersion,`Mixed DSH SDK versions (${name}).`);
  assert.equal(manifest.peerDependencies['@deepseek-ai/'+name],manifest.engines.dsh);
}
const llm=require(path.join(root,'dsh-llm'));
const {Session,appendPluginRecord}=require(path.join(root,'dsh-session'));
const {installConnection}=require(path.join(root,'dsh-client-connection/lib/client.node.js'));
const {OptionsHost}=require('./host.cjs');
const {createAdapter}=require('./adapter.cjs');
async function main(){
  for(const key of ['LlmAdapter','LlmError','attributionHeaders','resolveRetryPolicy','isAgentLoopRequest'])assert.equal(typeof llm[key],'function');
  const session=Session.create('sdk-test');
  session.append('model/selection',{provider:'shanghaitech-genai',model:'Kimi-k3'});
  const routes=new Map(), listeners=new Map();
  const {AgentModel}=require(path.join(root,'dsh-agent'));
  const agent={session,options:{provider:'shanghaitech-genai',model:'Kimi-k3'}};
  if (AgentModel) {
    agent.model = new AgentModel(() => ({
      pending: session.snapshotEvents().findLast(e=>e.type==='model/selection')?.data,
      lastUsed: null
    }), session, agent.options);
  }
  const ctx={credentials:{resolve:async()=>({value:'test'})},sessionQuery:{readSession:async()=>({session:session.header,events:session.snapshotEvents()})},sessions:{get:()=>session,flush:async()=>true},agents:{get:()=>agent},sessionController:{resolveAgent:async()=>({agent}),selectModel:()=>assert.fail('Must not select a profile default')},effect:f=>f(),on:(name,listener)=>listeners.set(name,listener),connection:{fetch:{register:r=>{routes.set(r.path,r);return()=>{};}}}};
  const caps={protocol_version:'1.1',conversations:{request_field:'conversation_id'},options:{sources_phase:'after_chat_completion'},usage:{stream_opt_in:'stream_options.include_usage'},models:[{id:'Kimi-k3',name:'Kimi-K3',search:{supported:true,default:false},thinking:{supported:true,default:false},attachments:{images:{supported:false}}}]};
  const host=new OptionsHost(ctx,appendPluginRecord,llm.attributionHeaders,async()=>Response.json(caps));host.install(sdkVersion);
  const old={...agent.options,reasoningEffort:'high'};
  session.append('model/selection',old);
  if (agent.model) {
    assert.equal(listeners.has('agent/request'),false);
    listeners.get('agent/created')({agent,source:'resume'});
    assert.deepEqual(agent.model.current(),agent.options);
  } else {
    const migrated=await listeners.get('agent/request')({agent},async()=>Object.freeze(old));
    assert.deepEqual(migrated,agent.options);
  }
  let client;
  installConnection({provide:(_name,value)=>{client=value;}},{transport:{fetch:async(url,init)=>{const u=new URL(url,'http://local/');const route=routes.get(u.pathname);assert(route,u.pathname);return route.fetch(new Request(u,init));}}});
  const read=await client.rpc.call('/api','shanghaitech.options.get',{sessionId:'sdk-test',model:'Kimi-k3'});assert.equal(read.ok,true);assert.equal(read.value.revision,0);
  const write=await client.rpc.call('/api','shanghaitech.options.set',{sessionId:'sdk-test',model:'Kimi-k3',search:true,thinking:true,expectedRevision:0});assert.equal(write.ok,true);assert.equal(write.value.search,true);
  assert.equal(session.snapshotEvents().at(-1).ignorable,true);
  const signal=new AbortController().signal;
  const decision={kind:'enter',messages:[]};
  assert.equal(await listeners.get('agent/pre-step')({agent,signal,modelSelection:agent.model?.current()},async()=>decision),decision);
  assert.deepEqual(host.stepOptions({...agent.options,sessionId:session.id,signal}),{search:true,thinking:true});
  const restored=Session.create('sdk-test',session.snapshotEvents(),session.header);assert.equal(restored.snapshotEvents().find(e=>e.type==='plugin:shanghaitech-genai/options').data.search,true);
  const adapter=createAdapter(llm,host,ctx);assert(adapter instanceof llm.LlmAdapter);assert.equal(adapter.providerRetryPolicy().maxRetries,8);assert.deepEqual(adapter.providerRetryPolicy().retryableCodes,['queue_full','queue_timeout']);assert.equal((await adapter.resolveModel('shanghaitech-genai','Kimi-k3')).reasoning,undefined);
  console.log(`PASS: DSH ${sdkVersion} SDK exports, real Session plugin record restore, real Connection RPC wire get/set, adapter inheritance and retry policy.`);
}
main().catch(e=>{console.error(e);process.exitCode=1;});
