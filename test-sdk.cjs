'use strict';
// Run with Electron-as-Node; argument points at this installed DSH's bundled @deepseek-ai directory.
const assert=require('node:assert/strict');
const path=require('node:path');
const root=process.argv[2];
if(!root)throw Error('Pass the installed DSH SDK directory.');
const llm=require(path.join(root,'dsh-llm'));
const {Session,appendPluginRecord}=require(path.join(root,'dsh-session'));
const {installConnection}=require(path.join(root,'dsh-client-connection/lib/client.node.js'));
const {OptionsHost}=require('./host.cjs');
const {createAdapter}=require('./adapter.cjs');
async function main(){
  for(const key of ['LlmAdapter','LlmError','attributionHeaders','resolveRetryPolicy','isAgentLoopRequest'])assert.equal(typeof llm[key],'function');
  const session=Session.create('sdk-test');
  session.append('model/selection',{provider:'shanghaitech-genai',model:'Kimi-k3'});
  const routes=new Map();
  const ctx={credentials:{resolve:async()=>({value:'test'})},sessionQuery:{readSession:async()=>({session:session.header,events:session.snapshotEvents()})},sessions:{get:()=>session,flush:async()=>true},sessionController:{selectModel:async({sessionId,...selection})=>session.append('model/selection',selection)},effect:f=>f(),on:()=>{},connection:{fetch:{register:r=>{routes.set(r.path,r);return()=>{};}}}};
  const caps={protocol_version:'1.1',conversations:{request_field:'conversation_id'},options:{sources_phase:'after_chat_completion'},usage:{stream_opt_in:'stream_options.include_usage'},models:[{id:'Kimi-k3',name:'Kimi-K3',search:{supported:true,default:false},thinking:{supported:true,default:false},attachments:{images:{supported:false}}}]};
  const host=new OptionsHost(ctx,appendPluginRecord,llm.attributionHeaders,async()=>Response.json(caps));host.install();
  let client;
  installConnection({provide:(_name,value)=>{client=value;}},{transport:{fetch:async(url,init)=>{const u=new URL(url,'http://local/');const route=routes.get(u.pathname);assert(route,u.pathname);return route.fetch(new Request(u,init));}}});
  const read=await client.rpc.call('/api','shanghaitech.options.get',{sessionId:'sdk-test',model:'Kimi-k3'});assert.equal(read.ok,true);assert.equal(read.value.revision,0);
  const write=await client.rpc.call('/api','shanghaitech.options.set',{sessionId:'sdk-test',model:'Kimi-k3',search:true,thinking:true,expectedRevision:0});assert.equal(write.ok,true);assert.equal(write.value.search,true);
  assert.equal(session.snapshotEvents().at(-1).ignorable,true);
  const restored=Session.create('sdk-test',session.snapshotEvents(),session.header);assert.equal(restored.snapshotEvents().find(e=>e.type==='plugin:shanghaitech-genai/options').data.search,true);
  const adapter=createAdapter(llm,host,ctx);assert(adapter instanceof llm.LlmAdapter);assert.equal(adapter.providerRetryPolicy().maxRetries,0);assert.equal((await adapter.resolveModel('shanghaitech-genai','Kimi-k3')).reasoning,undefined);
  console.log('PASS: installed DSH SDK exports, real Session plugin record restore, real Connection RPC wire get/set, adapter inheritance and retry policy.');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
