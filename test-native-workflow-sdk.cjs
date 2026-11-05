 'use strict';
// Installed SDK scheduling/retry implementations, synthetic children; no model requests.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {createRequire}=require('node:module');
const sdk=createRequire(path.join(process.env.DSH_TEST_SDK_ROOT,'package.json'));
const {createAdapter}=require('./adapter.cjs');
async function main(){
 const {Context}=sdk('@deepseek-ai/cordis');
 const {SessionProjectionRegistry}=sdk('@deepseek-ai/dsh-session-projection');
 const {Session}=sdk('@deepseek-ai/dsh-session');
 const llm=sdk('@deepseek-ai/dsh-llm');
 const root=new Context();
 try{
  await root.plugin(sdk('@deepseek-ai/dsh-agent').AgentRegistry).await();
  await root.plugin(SessionProjectionRegistry).await();
  await root.plugin(sdk('@deepseek-ai/dsh-llm-retry')).await();
  const session=Session.create('native-retry-probe'),agent={session};
  const policy=createAdapter(llm,{},{}).providerRetryPolicy();
  const request={agent,turn:1,step:1,provider:'shanghaitech-genai',retryPolicy:policy,signal:new AbortController().signal};
  // Provider wait advice accelerates this offline test; production policy is unmodified.
  const recover=code=>root.waterfall('agent/request-error',{...request,failure:{code,message:'synthetic',providerRetryAfterMs:1}},async()=>undefined);
  for(let i=0;i<8;i++)assert.equal((await recover(i%2?'queue_timeout':'queue_full')).kind,'retry');
  assert.equal(await recover('queue_full'),undefined);
  for(const code of ['TIMEOUT','upstream_empty_stream','tool_bridge_invalid_output','GATEWAY_STREAM_ERROR','upstream_authentication_required'])assert.equal(await recover(code),undefined);
  const events=session.snapshotEvents();assert.equal(events.filter(e=>e.type==='llm/retry').length,8);assert.equal(events.filter(e=>e.type==='llm/retry-started').length,8);
  const controller=new AbortController();
  const cancelled=root.waterfall('agent/request-error',{...request,agent:{session:Session.create('native-retry-cancel')},signal:controller.signal,failure:{code:'queue_full',message:'synthetic'}},async()=>undefined);
  controller.abort();assert.equal(await cancelled,undefined);
 } finally{await root.fiber.dispose();}
 const source=fs.readFileSync(sdk.resolve('@deepseek-ai/dsh-workflow-ptc'),'utf8');
 const line=source.split('\n').find(line=>line.startsWith('const WORKFLOW_GUEST_SOURCE = '));
 assert(line,'Installed workflow guest bundle shape changed; inspect SDK before updating test.');
 const guest=vm.runInNewContext(line.slice('const WORKFLOW_GUEST_SOURCE = '.length));
 const {runWorkflowGuest}=await import('data:text/javascript;base64,'+Buffer.from(guest).toString('base64'));
 for(const count of [10,100]){
  let active=0,peak=0,created=0,disposed=0;
  const result=await runWorkflowGuest({
   async begin(){return {meta:{name:'sdk-queue-probe',description:'Synthetic children'},body:'return await parallel(Array.from({length:args.count},(_,i)=>()=>agent("task "+i)))',args:{count},limits:{maxConcurrentAgents:1,maxTotalAgents:1000,maxItemsPerCall:4096,syncTimeoutMs:5000}};},
   async startChild(){active++;peak=Math.max(peak,active);return {callId:++created,childId:'mock-'+created};},
   async childResult(){await new Promise(r=>setTimeout(r,1));return {stopReason:'completed',output:[{type:'text',text:'ok'}]};},
   async disposeChild(){active--;disposed++;},async progress(){}
  });
  assert.equal(result.stopReason,'completed');assert.equal(result.value.length,count);assert.equal(peak,1);assert.equal(active,0);assert.equal(disposed,count);
 }
 console.log(JSON.stringify({status:'PASS',checks:['native workflow creates 10/100 children at capacity 1','native retry projection and 8-attempt cap','only pre-generation queue errors retry','native backoff cancellation'],upstream_requests:0,real_agents:0}));
}
main().catch(e=>{console.error(e);process.exitCode=1;});
