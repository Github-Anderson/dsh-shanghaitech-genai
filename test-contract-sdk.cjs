'use strict';
// The real installed SDK assembles and durably snapshots these mock responses.
const assert=require('node:assert/strict');
const {createRequire}=require('node:module');
const shipped=createRequire(require('node:path').join(process.env.DSH_TEST_SDK_ROOT || require('node:path').join(require('node:os').homedir(),'AppData/Local/Programs/DeepSeek Harness/resources/app.asar/dsh'),'package.json'));
const llm=shipped('@deepseek-ai/dsh-llm');
const {createAdapter}=require('./adapter.cjs');
const {conversationId}=require('./gateway-contract.cjs');
const frame=value=>'data: '+JSON.stringify(value)+'\n\n';
async function main(){
  const wire=[];
  const sources={count:1,links:[{num:1,title:'SDK source',link:'https://example.invalid/source',snippet:'Synthetic evidence'}]};
  const host={snapshots:new Map(),snapshot:async()=>({search:true,thinking:false}),headers:async()=>({Authorization:'Bearer synthetic'}),
    fetch:async(_url,init)=>{
      wire.push(JSON.parse(init.body));
      const body=frame({choices:[{delta:{content:'Synthetic answer'},finish_reason:'stop'}],
        shanghaitech:{sources_status:'ready',sources,upstream_metadata:{totalTokens:66}}})+
        frame({choices:[],usage:{prompt_tokens:14,completion_tokens:29,total_tokens:43}})+'data: [DONE]\n\n';
      const raw=new TextEncoder().encode(body);
      return new Response(new ReadableStream({start(c){for(let i=0;i<raw.length;i+=3)c.enqueue(raw.slice(i,i+3));c.close();}}));
    }};
  const adapter=createAdapter(llm,host,{}), assembler=new llm.BlockAssembler(), accumulator=new llm.AssistantStreamAccumulator();
  let time=1;
  for await(const chunk of adapter.stream({provider:'shanghaitech-genai',model:'qwen-instruct',sessionId:'sdk-contract',
    messages:[llm.createUserMessage({source:{kind:'user'},content:[{type:'text',text:'synthetic'}]})]})) {
    assembler.push(chunk);accumulator.push({time:time++,chunk});
  }
  assert.deepEqual(assembler.usage,{inputTokens:14,outputTokens:29,totalTokens:43});
  assert.equal(assembler.finish.kind,'stop');
  assert(assembler.blocks().some(b=>b.type==='text'&&b.text.includes('搜索来源')));
  assert.deepEqual(assembler.replayState.response.sources,sources);
  assert.equal(assembler.replayState.response.upstream_metadata.totalTokens,66);
  const restored=new llm.BlockAssembler();
  for(const timed of llm.expandAssistantStream(JSON.parse(JSON.stringify(accumulator.snapshot()))))restored.push(timed.chunk);
  assert.deepEqual(restored.usage,assembler.usage);
  assert.deepEqual(restored.replayState,assembler.replayState);
  assert.equal(wire[0].conversation_id,conversationId('sdk-contract'));
  assert.deepEqual(wire[0].stream_options,{include_usage:true});
  console.log('PASS: installed DSH SDK BlockAssembler usage, references and ReplayEnvelope; durable stream snapshot/restore; no inference or tools executed.');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
