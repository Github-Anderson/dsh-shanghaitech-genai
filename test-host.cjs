'use strict';
const assert=require('node:assert/strict');
const {OptionsHost,RECORD,fold}=require('./host.cjs');
const {createAdapter,messagesOf}=require('./adapter.cjs');
const {installAttachmentRouting}=require('./attachment-routing.cjs');
const capabilities={protocol_version:'1.1',conversations:{request_field:'conversation_id'},options:{sources_phase:'after_chat_completion'},usage:{stream_opt_in:'stream_options.include_usage'},models:['Kimi-k3','deepseek-pro'].map(id=>({id,name:id,search:{supported:true,default:false},thinking:{supported:id==='Kimi-k3',default:false},attachments:{images:{supported:id==='deepseek-pro'}}}))};
const events=[{type:'model/selection',data:{provider:'shanghaitech-genai',model:'Kimi-k3',reasoningEffort:'high'}}];
const live={id:'s',snapshotEvents:()=>structuredClone(events)};
let flush=true, attached=true, resumes=0;
const routes=[], listeners={};
const ctx={credentials:{resolve:async()=>({value:'fake-local-key'})},sessionQuery:{readSession:async id=>({session:{id,origin:id==='child'?'subagent':'user',...(id==='child'?{parentSession:'s'}:{})},events:structuredClone(events)})},sessions:{get:id=>id==='s'&&attached?live:undefined,flush:async()=>flush},sessionController:{
  selectModel:()=>assert.fail('Saving plugin options must not write the DSH profile default'),
  resolveAgent:async id=>{assert.equal(id,'s');resumes++;attached=true;return {agent:{session:live}};}
},effect:f=>f(),connection:{fetch:{register:r=>{routes.push(r);return()=>{};}}},on:(name,handler)=>{listeners[name]=handler;}};
const host=new OptionsHost(ctx,(_s,type,data)=>events.push({type,data}),()=>({'x-client':'test'}),async()=>Response.json(capabilities));
class LlmError extends Error{constructor(message,code){super(message);this.code=code;}}
class LlmAdapter{async prepareCall(p,m,s){return {model:await this.resolveModel(p,m,s),stream:o=>this.stream(o)}}}
const llm={LlmAdapter,LlmError,resolveRetryPolicy:p=>p,isAgentLoopRequest:()=>true};
function streamResponse(parts){return new Response(new ReadableStream({start(c){for(const part of parts)c.enqueue(new TextEncoder().encode(part));c.close();}}),{headers:{'content-type':'text/event-stream'}});}
const data=o=>'data: '+JSON.stringify(o)+'\n\n';
async function collect(iter){const items=[];for await(const i of iter)items.push(i);return items;}
async function main(){
  const initial=events.splice(0);ctx.agentDefaultModel={currentSelection:()=>({provider:'shanghaitech-genai',model:'Kimi-k3',reasoningEffort:'high'})};
  assert.equal((await host.get({sessionId:'s',model:'Kimi-k3'})).thinking,false);
  attached=false;
  await host.set({sessionId:'s',model:'Kimi-k3',search:false,thinking:false,expectedRevision:0});
  assert.equal(resumes,1);
  assert.deepEqual(events.map(e=>e.type),[RECORD],'A cold writer is acquired without selecting a model');
  events.splice(0,events.length,...initial);delete ctx.agentDefaultModel;
  assert.deepEqual((({search,thinking})=>({search,thinking}))(await host.get({sessionId:'s',model:'Kimi-k3'})),{search:false,thinking:false});
  const saved=await host.set({sessionId:'s',model:'Kimi-k3',search:false,thinking:true,expectedRevision:0});assert.equal(saved.revision,1);
  await assert.rejects(host.set({sessionId:'s',model:'Kimi-k3',search:true,thinking:true,expectedRevision:0}),/another view/);
  const frozen=await host.snapshot('s','Kimi-k3');await host.set({sessionId:'s',model:'Kimi-k3',search:true,thinking:false,expectedRevision:1});assert.deepEqual(frozen,{search:false,thinking:true});
  flush=false;await assert.rejects(host.set({sessionId:'s',model:'Kimi-k3',search:false,thinking:true,expectedRevision:2}));assert.equal((await host.get({sessionId:'s',model:'Kimi-k3'})).search,true);await assert.rejects(host.snapshot('s','Kimi-k3'));flush=true;
  assert.deepEqual(await host.snapshot('child','Kimi-k3'),{search:true,thinking:false});await assert.rejects(host.get({sessionId:'child',model:'Kimi-k3'}),/parent/);
  const restored=new OptionsHost(ctx,host.append,host.attribution,host.fetch);assert.equal((await restored.get({sessionId:'s',model:'Kimi-k3'})).revision,4);
  host.install('0.2.2-rc.1');
  assert.deepEqual(routes.map(route=>route.path),[
    '/api/shanghaitech.session.deleteEligibility','/api/shanghaitech.session.delete',
    '/api/shanghaitech.options.get','/api/shanghaitech.options.set',
  ]);
  assert.equal(listeners['agent/request'],undefined);
  const reply=await routes.find(row=>row.path==='/api/shanghaitech.options.get').fetch(new Request('http://local/api/shanghaitech.options.get',{method:'POST',body:JSON.stringify({type:'client-request',rpcId:'r',method:'shanghaitech.options.get',payload:{sessionId:'s',model:'Kimi-k3'}})}));assert.equal((await reply.json()).result.value.thinking,false);
  const route={provider:'shanghaitech-genai',model:'Kimi-k3'};
  const oldChoice={...route,reasoningEffort:'high'};
  const legacy={session:live,model:{
    current:()=>fold(events,route.model).selected,
    select:selection=>events.push({type:'model/selection',data:selection})
  }};
  listeners['agent/created']({agent:legacy,source:'startup'});
  assert.deepEqual(legacy.model.current(),oldChoice);
  const beforeMigration=events.slice();
  listeners['agent/created']({agent:legacy,source:'resume'});
  listeners['agent/created']({agent:legacy,source:'resume'});
  assert.deepEqual(events,[...beforeMigration,{type:'model/selection',data:route}],'Restore appends one local selection and retains history');
  const foreign={session:live,model:{current:()=>({...oldChoice,provider:'deepseek'}),select:()=>assert.fail('Foreign provider')}};
  listeners['agent/created']({agent:foreign,source:'resume'});

  const signal=new AbortController().signal;
  const preStep={agent:legacy,modelSelection:route,signal};
  const enter=Object.freeze({kind:'enter',messages:[]});
  const reject=Object.freeze({kind:'reject'});
  assert.equal(await listeners['agent/pre-step'](preStep,async()=>reject),reject);
  assert.equal(host.stepOptions({...route,sessionId:'s',signal}),undefined);
  assert.equal(await listeners['agent/pre-step']({...preStep,modelSelection:{provider:'deepseek',model:'native'}},async()=>enter),enter);
  assert.equal(host.stepOptions({...route,sessionId:'s',signal}),undefined);
  assert.equal(await listeners['agent/pre-step'](preStep,async()=>enter),enter);
  assert.deepEqual(host.stepOptions({...route,sessionId:'s',signal}),{search:true,thinking:false});
  assert.equal(host.stepOptions({...route,sessionId:'other',signal}),undefined);
  let wire;host.fetch=async(url,init)=>{wire=JSON.parse(init.body);return streamResponse([data({choices:[{delta:{reasoning_content:'思考'}}]}).slice(0,13),data({choices:[{delta:{reasoning_content:'思考'}}]}).slice(13),data({choices:[{delta:{content:'答案'},finish_reason:'stop'}]}),'data: [DONE]\n\n']);};
  const adapter=createAdapter(llm,host,ctx);const options={provider:'shanghaitech-genai',model:'Kimi-k3',sessionId:'s',system:'sys',messages:[{role:'user',content:[{type:'text',text:'hello'}]}]};
  const chunks=await collect(adapter.stream(options));assert.deepEqual(wire.shanghaitech,{search:true,thinking:false});assert(!('reasoning_effort'in wire));assert.equal(wire.messages[0].content,'sys');assert.equal(chunks.at(-1).reason.kind,'stop');assert.equal(chunks.at(-1).replayState.response.kind,'shanghaitech');assert(!chunks.some(c=>c.type==='usage'));assert(chunks.some(c=>c.type==='reasoning-delta'));
  host.fetch=async()=>streamResponse([data({choices:[{delta:{tool_calls:[{index:0,id:'call-1',function:{name:'read',arguments:'{"file_path":"x"}'}}]},finish_reason:'tool_calls'}]}),'data: [DONE]\n\n']);
  const tool=await collect(adapter.stream(options));assert.equal(tool.at(-1).reason.kind,'tool-calls');assert.equal(tool.find(c=>c.type==='block-end').block.arguments,'{"file_path":"x"}');
  const history=await messagesOf({...options,messages:[{role:'assistant',content:[{type:'tool-call',id:'c',name:'read',arguments:'{}'}]},{role:'tool',toolCallId:'c',content:[{type:'text',text:'real output'}]}]},ctx);assert.equal(history[1].tool_calls[0].id,'c');assert.equal(history[2].tool_call_id,'c');
  host.fetch=async()=>streamResponse([data({choices:[{delta:{content:'incomplete'},finish_reason:'stop'}]})]);await assert.rejects(collect(adapter.stream(options)),/without/);
  host.fetch=async()=>streamResponse([data({error:{code:'upstream_timeout',message:'Timed out'}})]);await assert.rejects(collect(adapter.stream(options)),e=>e.code==='upstream_timeout');
  for(const code of ['queue_full','queue_timeout']) {
    host.fetch=async()=>Response.json({error:{code,message:'Queue busy'}},{status:429});
    await assert.rejects(collect(adapter.stream(options)),e=>e.code===code);
    host.fetch=async()=>Response.json({error:{code,message:'Wrong phase'}},{status:502});
    await assert.rejects(collect(adapter.stream(options)),e=>e.code==='GATEWAY_STREAM_ERROR');
    host.fetch=async()=>streamResponse([data({choices:[{delta:{content:'partial'}}]}),data({error:{code,message:'Wrong phase'}})]);
    await assert.rejects(collect(adapter.stream(options)),e=>e.code==='GATEWAY_STREAM_ERROR');
  }
  assert.deepEqual(adapter.providerRetryPolicy().retryableCodes,['queue_full','queue_timeout']);
  assert.equal((await adapter.resolveModel('shanghaitech-genai','Kimi-k3')).reasoning,undefined);
  host.fetch=async()=>Response.json(capabilities);
  for(const model of ['GPT-6.1-Sol','deepseek-pro','chatglm','qwen-instruct']) {
    const cap={id:model,name:model,search:{supported:true,default:false},thinking:{supported:model!=='qwen-instruct',default:false},max_output_tokens:16384,attachments:{images:{supported:true}}};
    capabilities.models=capabilities.models.filter(m=>m.id!==model).concat(cap);
    host.capabilityCache=null;
    events.push({type:'model/selection',data:{provider:'shanghaitech-genai',model}});
    let state=await host.get({sessionId:'s',model,activate:true});
    assert.equal(state.thinking,false);assert.equal(state.search,true);
    state=await host.set({sessionId:'s',model,search:true,thinking:model!=='qwen-instruct',expectedRevision:state.revision});
    assert.equal((await host.snapshot('s',model)).thinking,model!=='qwen-instruct');
    state=await host.get({sessionId:'s',model,activate:true});
    assert.equal(state.thinking,false,'Restoring a conversation resets Thinking');
    assert.equal(state.search,true,'Restoring preserves the active Search choice');
  }
  host.fetch=async(url,init)=>{wire=JSON.parse(init.body);return streamResponse([data({choices:[{delta:{content:'answer'},finish_reason:'stop'}]}),'data: [DONE]\n\n']);};
  await collect(adapter.stream({...options,model:'qwen-instruct',maxTokens:65536,purpose:'compaction'}));
  assert.equal(wire.max_tokens,16384,'Native compaction uses the website output ceiling');
  let catalogCalls=[];
  host.fetch=async(url)=>{catalogCalls.push(url);return Response.json(capabilities);};
  host.capabilityCache=null;
  await host.capabilities();await host.capabilities();assert.equal(catalogCalls.length,1);
  await adapter.listModels();assert.equal(catalogCalls.length,2);
  assert(catalogCalls.at(-1).endsWith('/capabilities?refresh=true'));
  installAttachmentRouting(ctx, request=>request.main?host.stepOptions(request):undefined);
  events.push({type:'model/selection',data:route});
  const step={...options,signal,main:true};
  await listeners['agent/pre-step'](preStep,async()=>enter);
  const initialFlags=host.stepOptions(step);
  const state=await host.get({sessionId:'s',model:route.model});
  await host.set({sessionId:'s',model:route.model,search:!initialFlags.search,thinking:true,expectedRevision:state.revision});
  host.fetch=async(url,init)=>{wire=JSON.parse(init.body);return streamResponse([data({choices:[{delta:{content:'answer'},finish_reason:'stop'}]}),'data: [DONE]\n\n']);};
  const run=request=>collect(listeners['llm/stream'](request,()=>adapter.stream({...request})));
  await run(step);
  assert.deepEqual(wire.shanghaitech,initialFlags);
  await run({...step,main:false,purpose:'compaction'});
  assert.deepEqual(wire.shanghaitech,{search:!initialFlags.search,thinking:true});
  await run({...step});
  assert.deepEqual(wire.shanghaitech,initialFlags,'A retry keeps the accepted step settings');
  await listeners['agent/pre-step'](preStep,async()=>enter);
  await run(step);
  assert.deepEqual(wire.shanghaitech,{search:!initialFlags.search,thinking:true},'The next step reads updated settings');
  const canceled=AbortSignal.abort();
  await assert.rejects(listeners['agent/pre-step']({...preStep,signal:canceled},async()=>enter),{name:'AbortError'});
  assert.equal(host.stepOptions({...step,signal:canceled}),undefined);
  console.log('PASS: local legacy restore, profile default isolation, step retries and auxiliary calls, option persistence, provider isolation, and gateway contract.');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
