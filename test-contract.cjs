'use strict';
const assert=require('node:assert/strict');
const {createAdapter}=require('./adapter.cjs');
const {OptionsHost}=require('./host.cjs');
const {conversationId,usageOf}=require('./gateway-contract.cjs');
const data=o=>'data: '+JSON.stringify(o)+'\n\n';
const usage={prompt_tokens:3026,completion_tokens:906,total_tokens:3932,
  prompt_tokens_details:{cached_tokens:0,created_cache_tokens:2800},completion_tokens_details:{reasoning_tokens:0}};
const sources={links:[{num:1,title:'A [source] *title*',link:'https://example.invalid/page?q=1',snippet:'Untrusted evidence.'}],count:1};
class LlmError extends Error{constructor(message,code){super(message);this.code=code;}}
const llm={LlmAdapter:class{},LlmError,resolveRetryPolicy:p=>p};
const collect=async it=>{const out=[];for await(const e of it)out.push(e);return out;};
async function exercise({metadata={sources_status:'ready',sources,upstream_metadata:{totalTokens:5768}},stats=usage,
                         purpose,sessionId='session-id',content='Answer',afterFinish=false,includeText=true}={}) {
  let wire;
  const host={snapshots:new Map(),snapshot:async()=>({search:true,thinking:false}),headers:async()=>({Authorization:'Bearer synthetic'}),
    fetch:async(_url,options)=>{
      wire=JSON.parse(options.body);
      const body=data({choices:[{delta:includeText?{content}:{},finish_reason:'stop'}],shanghaitech:metadata})+
        (afterFinish?data({choices:[{delta:{content:'invalid late text'}}]}):'')+
        data({choices:[],usage:stats,...!includeText?{shanghaitech:metadata}:{}})+'data: [DONE]\n\n';
      return new Response(body,{headers:{'Content-Type':'text/event-stream'}});
    }};
  const chunks=await collect(createAdapter(llm,host,{}).stream({model:'qwen-instruct',sessionId,purpose,
    messages:[{role:'user',content:[{type:'text',text:'synthetic'}]}]}));
  return {wire,chunks,replay:chunks.at(-1).replayState.response};
}
async function main(){
  const id=conversationId('session-id');assert.match(id,/^dsh-v1-[a-f0-9]{64}$/);
  assert.equal(id,conversationId('session-id'));assert.notEqual(id,conversationId('child-session'));
  assert.notEqual(id,conversationId('session-id','compaction'));assert.notEqual(id,conversationId('session-id','session-title'));
  assert.equal(conversationId(undefined),undefined);assert.throws(()=>conversationId(''));
  let result=await exercise();
  assert.equal(result.wire.conversation_id,id);assert.deepEqual(result.wire.stream_options,{include_usage:true});
  assert.equal(result.replay.conversation_id,id);assert.deepEqual(result.replay.sources,sources);
  assert.equal(result.replay.upstream_metadata.totalTokens,5768);
  assert.equal(result.replay.usage.total_tokens,3932);
  const counts=result.chunks.filter(c=>c.type==='usage');assert.equal(counts.length,1);
  assert.deepEqual(counts[0].usage,{inputTokens:226,outputTokens:906,totalTokens:3932,cacheReadTokens:0,cacheWriteTokens:2800,reasoningTokens:0});
  const displayed=result.chunks.filter(c=>c.type==='text-delta').map(c=>c.text).join('');
  assert(displayed.startsWith('Answer'));assert(displayed.includes('搜索来源（网站返回）'));
  assert(displayed.includes('A \\[source\\] \\*title\\*'));assert(!displayed.includes('Untrusted evidence.'));
  assert.equal(result.chunks.at(-1).reason.kind,'stop');assert.equal(result.chunks.at(-2).type,'usage');
  result=await exercise({stats:null,metadata:{}});assert(!result.chunks.some(c=>c.type==='usage'));
  assert.equal(result.replay.usage,undefined);assert.equal(result.replay.upstream_metadata,undefined);
  result=await exercise({stats:{prompt_tokens:14},metadata:{upstream_metadata:{totalTokens:66}}});
  assert(!result.chunks.some(c=>c.type==='usage'));assert.equal(result.replay.upstream_metadata.totalTokens,66);
  assert.equal(usageOf({prompt_tokens:-1,completion_tokens:2}),undefined);
  result=await exercise({metadata:{sources_status:'failed',sources_error:'sources_timeout'}});
  assert.equal(result.replay.sources_status,'failed');assert(result.chunks.some(c=>c.text?.includes('以上回答已保留')));
  result=await exercise({metadata:{sources_status:'ready',sources:{links:[],count:0}}});
  assert(result.chunks.some(c=>c.text?.includes('本轮未返回来源链接')));
  for(const link of ['javascript:alert(1)','https://[','https://user:password@example.invalid','https://example.invalid/\nspoof']){
    result=await exercise({metadata:{sources_status:'ready',sources:{links:[{...sources.links[0],link}],count:1}}});
    assert.equal(result.replay.sources_status,'failed');assert.equal(result.replay.sources,undefined);
  }
  result=await exercise({purpose:'session-title'});assert.equal(result.wire.conversation_id,conversationId('session-id','session-title'));
  assert(!result.chunks.some(c=>c.text?.includes('搜索来源')));
  await assert.rejects(exercise({includeText:false}),e=>e.code==='EMPTY_RESPONSE');
  await assert.rejects(exercise({afterFinish:true}),e=>e.code==='INVALID_RESPONSE');
  const host=new OptionsHost({credentials:{resolve:async()=>({value:'synthetic'})}},()=>{},()=>({}),
    async()=>Response.json({protocol_version:'1.1',models:[]}));
  await assert.rejects(host.capabilities(),e=>e.code==='shanghaitech/protocol-mismatch');
  console.log('PASS: stable conversation routing, purpose isolation, source validation/rendering/replay, failure preservation, trailing usage, cache split, absent usage and old-gateway rejection.');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
