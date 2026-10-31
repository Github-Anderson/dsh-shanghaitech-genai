// Exercises the actual installed AttachmentStore request shape, without image I/O.
const assert = require('node:assert/strict');
const {messagesOf,createAdapter} = require('./adapter.cjs');
async function main() {
  const ref = {attachmentId:'sha256:synthetic',mediaType:'image/png',width:500,height:280,bytes:8};
  const data = new Uint8Array([137,80,78,71,13,10,26,10]);
  const signal = new AbortController().signal;
  let reads=0;
  const ctx={attachments:{async readImageRequest(value,target,passed){
    assert.equal(value,ref);assert.deepEqual(target,{width:500,height:280,maxBytes:1048576});assert.equal(passed,signal);reads++;
    return {data,mediaType:'image/png',width:500,height:280,bytes:data.length};
  }}};
  const messages=[{role:'user',content:[{type:'text',text:'Inspect this image'},{type:'image',attachment:ref}]},
    {role:'tool',toolCallId:'call-synthetic',content:[{type:'image',attachment:ref}]}];
  const out=await messagesOf({messages,signal},ctx);
  assert.equal(reads,1,'Repeated images share the exact prepared request image');
  assert.equal(out[0].content[1].image_url.url,'data:image/png;base64,'+Buffer.from(data).toString('base64'));
  assert.equal(out[1].tool_call_id,'call-synthetic');
  const offloaded=await messagesOf({messages:[{role:'user',content:[{type:'image',attachment:ref,offloaded:true}]}],signal},ctx);
  assert.equal(reads,1,'Offloaded images never reload image bytes');
  assert(offloaded[0].content.includes('omitted'));
  await assert.rejects(messagesOf({messages,signal},{}),/attachment service/);
  const adapter=createAdapter({LlmAdapter:class{},LlmError:Error}, {}, ctx);
  assert.deepEqual(adapter.imageRequestTarget('shanghaitech-genai','deepseek-pro',ref),{width:500,height:280,maxBytes:1048576},'Request and coordinate projection targets match');
  console.log('PASS: native image request contract, tool images, MIME/base64, per-request reuse, offloaded image omission, coordinate target');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
