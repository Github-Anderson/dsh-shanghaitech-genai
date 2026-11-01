'use strict';
const assert=require('node:assert/strict');
const {createHash}=require('node:crypto');
const {createRequire}=require('node:module');
const path=require('node:path');
const shipped=createRequire(path.join(process.env.DSH_TEST_SDK_ROOT||path.join(require('node:os').homedir(),'AppData/Local/Programs/DeepSeek Harness/resources/app.asar/dsh'),'package.json'));
const llm=shipped('@deepseek-ai/dsh-llm');
const {Context}=shipped('@deepseek-ai/cordis');
const {createAdapter}=require('./adapter.cjs');
const {installAttachmentRouting}=require('./attachment-routing.cjs');
const {conversationId}=require('./gateway-contract.cjs');
const {gatewayBaseUrl}=require('./gateway-url.cjs');
const originalFetch=global.fetch;
async function main(){
 const root=new Context(),uploads=[],wire=[],sources=new Map();let denied=false;
 const fs={processPathFromHostPath:p=>p,resolve:async p=>{if(denied)throw Error('Sandbox denied');return p;},stat:async p=>({type:'file',size:sources.get(p).length}),readBytes:async p=>sources.get(p)};
 const core={adapters:new Map(),ctx:{get:n=>n==='fs'?fs:{fileHostPath:r=>r.attachmentId}},fileReadPath:r=>r.attachmentId,
   forAdapter:llm.LlmRuntime.prototype.forAdapter};
 core.fileRequestText=r=>llm.LlmRuntime.prototype.fileRequestText.call(core,r);
 const ctx={on:(...args)=>root.on(...args),llm:core,fs,attachments:{fileHostPath:r=>r.attachmentId},credentials:{resolve:async()=>({value:'synthetic-key'})}};
 installAttachmentRouting(ctx);
 const host={snapshots:new Map(),snapshot:async()=>({search:false,thinking:false}),headers:async()=>({Authorization:'Bearer synthetic-key'}),fetch:async(url,init)=>{
   wire.push(JSON.parse(init.body));return new Response('data: '+JSON.stringify({choices:[{delta:{content:'synthetic answer'},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n');
 }};
 global.fetch=async(url,init)=>{
   assert.equal(url,gatewayBaseUrl()+'/files');assert.equal(init.redirect,'error');assert.equal(init.body.get('include_content'),'false');
   const bytes=Buffer.from(await init.body.get('file').arrayBuffer());uploads.push({bytes,conversation:init.body.get('conversation_id'),model:init.body.get('model'),mime:init.body.get('file').type});
   await new Promise(r=>setTimeout(r,5));
   return Response.json({id:'file-'+uploads.length,kind:init.body.get('file').type.startsWith('image/')?'image':'document',model:init.body.get('model'),status:'ready',sha256:createHash('sha256').update(bytes).digest('hex'),expires_at:Math.floor(Date.now()/1000)+3600});
 };
 const adapter=createAdapter(llm,host,ctx);core.adapters.set('shanghaitech-genai',{adapter});
 const ref=(name,raw)=>{const r={name,bytes:raw.length,attachmentId:'sha256:'+createHash('sha256').update(raw).digest('hex')};sources.set(r.attachmentId,raw);return r;};
 const run=async(session,content,source={kind:'user',rpcId:'synthetic'})=>{
   const options=Object.freeze({provider:'shanghaitech-genai',model:'deepseek-pro',sessionId:session,maxTokens:512,messages:[llm.createUserMessage({source,content})],tools:[{name:'read',parameters:{type:'object'}}]});
   const prepared={registration:{adapter},config:{provider:'shanghaitech-genai',model:'deepseek-pro',maxTokens:512},modelInfo:{inputModalities:['text','image']},dispatch:o=>adapter.stream(o)};
   const stream=root.waterfall(core,'llm/stream',options,()=>llm.LlmRuntime.prototype.adapterStream.call(core,options,prepared));
   const out=[];for await(const c of stream)out.push(c);
   const finish=out.find(c=>c.type==='finish');return {finish,options};
 };
 try {
   const txt=ref('one.txt',Buffer.from('TXT_MARKER')),pdf=ref('two.pdf',Buffer.from('%PDF-synthetic'));
   const result=await run('a',[{type:'text',text:'read both'},{type:'file',attachment:txt},{type:'file',attachment:pdf}]);
   assert.equal(result.finish.reason.kind,'stop');assert.equal(uploads.length,2);
   assert(wire.at(-1).messages[0].content.filter(p=>p.type==='file').length===2);
   assert(uploads.every(u=>u.conversation===conversationId('a')));
   assert.equal(result.options.messages[0].content[1].type,'file','Frozen durable history remains typed');
   assert.equal(wire.at(-1).tools[0].function.name,'read','Native local tools remain available');
   const before=uploads.length;
   await run('local',[{type:'text',text:'@local.txt read it with read'},{type:'text',text:core.fileRequestText(txt)}]);
   await run('local',[{type:'file',attachment:txt}],{kind:'file-reference'});
   assert.equal(uploads.length,before,'@paths and forged handles never upload');
   const gif=ref('animated.gif',Buffer.from('GIF89a\x01\0\x01\0','binary'));
   await run('gif',[{type:'file',attachment:gif}]);assert.equal(uploads.at(-1).mime,'image/gif');assert(uploads.at(-1).bytes.equals(sources.get(gif.attachmentId)));
   await Promise.all([run('parallel-a',[{type:'file',attachment:txt}]),run('parallel-b',[{type:'file',attachment:pdf}])]);
   assert(uploads.some(u=>u.conversation===conversationId('parallel-a')&&u.bytes.equals(sources.get(txt.attachmentId))));
   assert(uploads.some(u=>u.conversation===conversationId('parallel-b')&&u.bytes.equals(sources.get(pdf.attachmentId))));
   for(const [ext,mime] of [['xls','application/vnd.ms-excel'],['xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
     ['ppt','application/vnd.ms-powerpoint'],['pptx','application/vnd.openxmlformats-officedocument.presentationml.presentation'],['html','text/html'],['json','application/json']]){
     const raw=Buffer.from('FORMAT_PROBE_'+ext),file=ref('probe.'+ext.toUpperCase(),raw);
     const sent=await run('format-'+ext,[{type:'file',attachment:file}]);
     assert.equal(sent.finish.reason.kind,'stop');assert.equal(uploads.at(-1).mime,mime);assert(uploads.at(-1).bytes.equals(raw));
     assert.equal(wire.at(-1).messages[0].content.filter(p=>p.type==='file').length,1);
   }
   denied=true;const count=uploads.length;const failure=await run('denied',[{type:'file',attachment:txt}]);
   assert.equal(failure.finish.reason.kind,'error');assert.equal(uploads.length,count);denied=false;
   const bad=ref('one.md',Buffer.from('# no fallback'));const unsupported=await run('bad',[{type:'file',attachment:bad}]);
   assert.equal(unsupported.finish.reason.kind,'error');assert.equal(uploads.length,count);
   for(const ext of ['doc','xml']){
     const rejected=await run('reject-'+ext,[{type:'file',attachment:ref('probe.'+ext,Buffer.from('unsupported'))}]);
     assert.equal(rejected.finish.reason.kind,'error');assert.equal(uploads.length,count);
   }
   console.log(JSON.stringify({status:'PASS',checks:['real Cordis waterfall','real SDK frozen-file projection','automatic multi-upload','same chat conversation','native tool catalog retained','local @paths excluded','forged handles excluded','raw GIF retained','concurrent request isolation','sandbox denial','unsupported format no fallback'],upstream_requests:0,real_tools_executed:0}));
 }finally{global.fetch=originalFetch;await root.fiber.dispose();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
