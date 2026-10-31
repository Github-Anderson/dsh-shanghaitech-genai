'use strict';
const assert=require('node:assert/strict');
const {OptionsHost,RECORD,fold}=require('./host.cjs');
const {createAdapter,messagesOf}=require('./adapter.cjs');
const capabilities={protocol_version:'1.1',conversations:{request_field:'conversation_id'},options:{sources_phase:'after_chat_completion'},usage:{stream_opt_in:'stream_options.include_usage'},models:['Kimi-k3','deepseek-pro'].map(id=>({id,name:id,search:{supported:true,default:false},thinking:{supported:id==='Kimi-k3',default:false},attachments:{images:{supported:id==='deepseek-pro'}}}))};
const events=[{type:'model/selection',data:{provider:'shanghaitech-genai',model:'Kimi-k3',reasoningEffort:'high'}}];
const live={id:'s'};let flush=true;const routes=[],listeners={};
const ctx={credentials:{resolve:async()=>({value:'fake-local-key'})},sessionQuery:{readSession:async id=>({session:{id,origin:id==='child'?'subagent':'user',...(id==='child'?{parentSession:'s'}:{})},events:structuredClone(events)})},sessions:{get:id=>id==='s'?live:undefined,flush:async()=>flush},sessionController:{selectModel:async()=>{}},effect:f=>f(),connection:{fetch:{register:r=>{routes.push(r);return()=>{};}}},on:(name,handler)=>{listeners[name]=handler;}};
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
  await host.set({sessionId:'s',model:'Kimi-k3',search:false,thinking:false,expectedRevision:0});assert.equal(events.at(-1).type,RECORD);
  events.splice(0,events.length,...initial);delete ctx.agentDefaultModel;
  assert.deepEqual((({search,thinking})=>({search,thinking}))(await host.get({sessionId:'s',model:'Kimi-k3'})),{search:false,thinking:false});
  const saved=await host.set({sessionId:'s',model:'Kimi-k3',search:false,thinking:true,expectedRevision:0});assert.equal(saved.revision,1);
  await assert.rejects(host.set({sessionId:'s',model:'Kimi-k3',search:true,thinking:true,expectedRevision:0}),/another view/);
  const frozen=await host.snapshot('s','Kimi-k3');await host.set({sessionId:'s',model:'Kimi-k3',search:true,thinking:false,expectedRevision:1});assert.deepEqual(frozen,{search:false,thinking:true});
  flush=false;await assert.rejects(host.set({sessionId:'s',model:'Kimi-k3',search:false,thinking:true,expectedRevision:2}));assert.equal((await host.get({sessionId:'s',model:'Kimi-k3'})).search,true);await assert.rejects(host.snapshot('s','Kimi-k3'));flush=true;
  assert.deepEqual(await host.snapshot('child','Kimi-k3'),{search:true,thinking:false});await assert.rejects(host.get({sessionId:'child',model:'Kimi-k3'}),/parent/);
  const restored=new OptionsHost(ctx,host.append,host.attribution,host.fetch);assert.equal((await restored.get({sessionId:'s',model:'Kimi-k3'})).revision,4);
  host.install();assert.equal(routes.length,2);
  const reply=await routes[0].fetch(new Request('http://local/api/shanghaitech.options.get',{method:'POST',body:JSON.stringify({type:'client-request',rpcId:'r',method:'shanghaitech.options.get',payload:{sessionId:'s',model:'Kimi-k3'}})}));assert.equal((await reply.json()).result.value.thinking,false);
  const config=await listeners['agent/request']({agent:{session:live}},async()=>({provider:'shanghaitech-genai',model:'Kimi-k3',reasoningEffort:'high'}));assert.equal(config.reasoningEffort,undefined);assert.equal(host.snapshots.get('s').value.thinking,false);
  let wire;host.fetch=async(url,init)=>{wire=JSON.parse(init.body);return streamResponse([data({choices:[{delta:{reasoning_content:'思考'}}]}).slice(0,13),data({choices:[{delta:{reasoning_content:'思考'}}]}).slice(13),data({choices:[{delta:{content:'答案'},finish_reason:'stop'}]}),'data: [DONE]\n\n']);};
  const adapter=createAdapter(llm,host,ctx);const options={provider:'shanghaitech-genai',model:'Kimi-k3',sessionId:'s',system:'sys',messages:[{role:'user',content:[{type:'text',text:'hello'}]}]};
  const chunks=await collect(adapter.stream(options));assert.deepEqual(wire.shanghaitech,{search:true,thinking:false});assert(!('reasoning_effort'in wire));assert.equal(wire.messages[0].content,'sys');assert.equal(chunks.at(-1).reason.kind,'stop');assert.equal(chunks.at(-1).replayState.response.kind,'shanghaitech');assert(!chunks.some(c=>c.type==='usage'));assert(chunks.some(c=>c.type==='reasoning-delta'));
  host.fetch=async()=>streamResponse([data({choices:[{delta:{tool_calls:[{index:0,id:'call-1',function:{name:'read',arguments:'{"file_path":"x"}'}}]},finish_reason:'tool_calls'}]}),'data: [DONE]\n\n']);
  const tool=await collect(adapter.stream(options));assert.equal(tool.at(-1).reason.kind,'tool-calls');assert.equal(tool.find(c=>c.type==='block-end').block.arguments,'{"file_path":"x"}');
  const history=await messagesOf({...options,messages:[{role:'assistant',content:[{type:'tool-call',id:'c',name:'read',arguments:'{}'}]},{role:'tool',toolCallId:'c',content:[{type:'text',text:'real output'}]}]},ctx);assert.equal(history[1].tool_calls[0].id,'c');assert.equal(history[2].tool_call_id,'c');
  host.fetch=async()=>streamResponse([data({choices:[{delta:{content:'incomplete'},finish_reason:'stop'}]})]);await assert.rejects(collect(adapter.stream(options)),/without/);
  host.fetch=async()=>streamResponse([data({error:{code:'upstream_timeout',message:'Timed out'}})]);await assert.rejects(collect(adapter.stream(options)),e=>e.code==='upstream_timeout');
  assert.equal((await adapter.resolveModel('shanghaitech-genai','Kimi-k3')).reasoning,undefined);
  console.log('PASS: host persistence, configured defaults, revisions, failed-save compensation, subagent inheritance, RPC, request snapshots, text/reasoning/tools, truncation/errors, unknown usage.');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
