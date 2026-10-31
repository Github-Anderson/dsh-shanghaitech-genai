"use strict";
const assert=require('node:assert/strict');
const {createAdapter,messagesOf}=require('./adapter.cjs');
const {BASE}=require('./host.cjs');
const {createRequire}=require('node:module');
const shipped=createRequire(require('node:path').join(process.env.DSH_TEST_SDK_ROOT || require('node:path').join(require('node:os').homedir(),'AppData/Local/Programs/DeepSeek Harness/resources/app.asar/dsh'),'package.json'));
const llm=shipped('@deepseek-ai/dsh-llm');
const sdkUser=(text,kind='user')=>llm.createUserMessage({source:{kind},content:[{type:'text',text}]});
const frames=o=>'data: '+JSON.stringify(o)+'\n\n';
function response(text){const bytes=new TextEncoder().encode(text);return new Response(new ReadableStream({start(c){for(let i=0;i<bytes.length;i+=7)c.enqueue(bytes.slice(i,i+7));c.close();}}));}
async function collect(stream){const chunks=[];for await(const c of stream)chunks.push(c);return chunks;}
function assemble(chunks){const a=new llm.BlockAssembler();for(const c of chunks)a.push(c);return a;}
async function main(){
 const calls=[],wire=[];
 const host={snapshots:new Map(),snapshot:async()=>({search:false,thinking:false}),headers:async()=>({Authorization:'Bearer synthetic-test-only'}),fetch:async(url,init)=>{
  assert.equal(url,BASE+'/chat/completions');const body=JSON.parse(init.body);wire.push(body);
  if(wire.length===1)return response(frames({choices:[{delta:{tool_calls:[{index:0,id:'call-offline',type:'function',function:{name:'pwsh',arguments:'{"description":"Read WSL information","command":"wsl.exe --exec fastfetch","timeoutMs":60000}'}}]}}]})+frames({choices:[{delta:{},finish_reason:'tool_calls'}]})+'data: [DONE]\n\n');
  return response(frames({choices:[{delta:{content:'Observed OFFLINE_WSL_MARKER.'},finish_reason:'stop'}]})+'data: [DONE]\n\n');
 }};
 const adapter=createAdapter(llm,host,{});
 const options={provider:'shanghaitech-genai',model:'deepseek-pro',sessionId:'offline-command-session',system:'Preserve client permissions.',messages:[sdkUser('Run WSL fastfetch.'),sdkUser('Workspace policy applies.','runtime-context'),sdkUser('Known tool skills.','skill-catalog'),sdkUser('Current test time.','time-context')],tools:[{name:'pwsh',description:'Execute via the existing client tool.',parameters:{type:'object',properties:{command:{type:'string'},description:{type:'string'},timeoutMs:{type:'number'}},required:['command','description']}}]};
 const chunks=await collect(adapter.stream(options));const first=assemble(chunks);
 assert.equal(first.finish.kind,'tool-calls');assert.equal(first.blocks().length,1);
 const call=first.blocks()[0];assert.equal(call.type,'tool-call');assert.equal(call.name,'pwsh');assert.equal(JSON.parse(call.arguments).command,'wsl.exe --exec fastfetch');
 assert.equal(wire[0].tools[0].function.name,'pwsh');assert.deepEqual(wire[0].shanghaitech,{search:false,thinking:false});
 assert.equal(wire[0].messages.filter(m=>m.role==='developer').length,3);assert.equal(wire[0].messages.filter(m=>m.role==='user').length,1);
 // The fake executor does not invoke a shell, WSL, filesystem writes or network.
 calls.push(call);const observation=llm.createToolResultMessage({callId:call.id,content:[{type:'text',text:'OFFLINE_WSL_MARKER\n[exit code: 0]'}],isError:false});
 options.messages.push(llm.createAssistantMessage({source:{provider:'shanghaitech-genai',model:'deepseek-pro'},content:[call]}),observation,sdkUser('New context snapshot.','runtime-context'));
 const second=assemble(await collect(adapter.stream(options)));assert.equal(second.finish.kind,'stop');assert.match(second.blocks()[0].text,/OFFLINE_WSL_MARKER/);
 const history=wire[1].messages;assert.equal(history.find(m=>m.role==='tool').tool_call_id,call.id);assert.equal(history.find(m=>m.role==='assistant').tool_calls[0].id,call.id);assert.equal(calls.length,1);
 const userExample=await messagesOf({messages:[sdkUser('runtime-context is just quoted text'),sdkUser('verbatim uploaded file','file-upload')]},{});assert(userExample.every(m=>m.role==='user'));
 // Real empty responses must stay errors, never be replaced by guessed commands.
 host.fetch=async()=>response(frames({choices:[{delta:{},finish_reason:'stop'}]})+'data: [DONE]\n\n');await assert.rejects(collect(adapter.stream(options)),e=>e.code==='EMPTY_RESPONSE');
 console.log(JSON.stringify({status:'PASS',sdk:'installed DSH',checks:['trusted runtime context roles','native pwsh declaration','real SDK tool-call assembly','call ID and arguments preserved','mock tool observation roundtrip','final answer assembly','ordinary user data remains user','empty stream rejected'],real_commands_executed:0,upstream_inference_requests:0}));
}
main().catch(e=>{console.error(e);process.exitCode=1;});
