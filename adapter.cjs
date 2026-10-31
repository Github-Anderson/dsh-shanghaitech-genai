'use strict';
const {PROVIDER}=require('./host.cjs');
const {gatewayBaseUrl}=require('./gateway-url.cjs');
const {uploadedFilePart}=require('./attachment-routing.cjs');
const {conversationId,usageOf,collectMetadata,sourceText,replayState}=require('./gateway-contract.cjs');
// Configured context capacities; retain the existing fallback for other models.
const CONTEXT_WINDOWS = Object.freeze({'GPT-6.1-Terra':1050000,'gpt-6-astra':1050000,'GPT-6-Luna':1050000,'chatglm':128*1024,'qwen-instruct':256*1024,'Kimi-k3':200*1024,'deepseek-pro':1024*1024});
function imageTarget(ref) { return {width:ref.width,height:ref.height,maxBytes:1024*1024}; }
async function messagesOf(options,ctx,ErrorType=Error,imageHelpers={}) {
  const messages=[];
  const preparedImages=new Map();
  if(options.system) messages.push({role:'system',content:options.system});
  for(const message of options.messages) {
    const parts=[],calls=[];
    for(const [index,block] of message.content.entries()) {
      if(block.type==='text') parts.push(await uploadedFilePart(block.text,options,ctx,ErrorType,message,index)??{type:'text',text:block.text});
      else if(block.type==='reasoning') { /* Provider-only reasoning is not replayed as user text. */ }
      else if(block.type==='tool-call' && message.role==='assistant') calls.push({id:block.id,type:'function',function:{name:block.name,arguments:block.arguments}});
      else if(block.type==='image' && ['user','tool'].includes(message.role)) {
        if(!ctx.attachments) throw new ErrorType('The DSH attachment service is unavailable.','UNSUPPORTED_CONTENT');
        const ref=block.attachment;
        const access=imageHelpers.resolveImageAttachmentAccess?.(ctx.attachments,hostPath=>ctx.fs?.processPathFromHostPath(hostPath),ref);
        if(block.offloaded===true) {
          parts.push({type:'text',text:imageHelpers.offloadedImageText?.(ref,access) || '[Image omitted to fit request image limits; its bytes were not sent.]'});
          continue;
        }
        let image=preparedImages.get(ref.attachmentId);
        if(!image) {
          image=await ctx.attachments.readImageRequest(ref,imageTarget(ref),options.signal);
          if(!['image/png','image/jpeg','image/webp','image/gif'].includes(image.mediaType) || !(image.data instanceof Uint8Array)) throw new ErrorType('Unsupported gateway image encoding.','UNSUPPORTED_CONTENT');
          preparedImages.set(ref.attachmentId,image);
        }
        if(imageHelpers.requestImageHandleText) parts.push({type:'text',text:imageHelpers.requestImageHandleText(ref,image,access)});
        parts.push({type:'image_url',image_url:{url:'data:'+image.mediaType+';base64,'+Buffer.from(image.data).toString('base64')}});
      } else throw new ErrorType('Unsupported DSH content block: '+block.type,'UNSUPPORTED_CONTENT');
    }
    const content=parts.every(p=>p.type==='text')?parts.map(p=>p.text).join('\n'):parts;
    // These source tags are assigned by the DSH host, not by message text.
    // Keep runtime snapshots out of the website's current user action. Never
    // promote ordinary user/file content or tool observations into instructions.
    const runtimeContext = message.role === 'user' && calls.length === 0 &&
      parts.every(p => p.type === 'text') &&
      ['runtime-context', 'skill-catalog', 'time-context'].includes(message.source?.kind);
    const role = runtimeContext ? 'developer' : message.role;
    messages.push({role,...message.role==='tool'?{tool_call_id:message.toolCallId}:{},content:calls.length && !content ? null : content,...calls.length?{tool_calls:calls}:{}});
  }
  return messages;
}
async function* sse(response,signal,ErrorType=Error) {
  if(!response.body)throw new ErrorType('Gateway returned no stream.','STREAM_CLOSED');
  const reader=response.body.getReader(),decoder=new TextDecoder(); let pending='',total=0;
  try {
    while(true) {
      signal?.throwIfAborted();
      const {value,done}=await reader.read();
      if(done)break;
      total+=value.length;if(total>8*1024*1024)throw new ErrorType('Gateway stream exceeded its size limit.','OUTPUT_LIMIT');
      pending+=decoder.decode(value,{stream:true});
      let match;
      while((match=/\r?\n\r?\n/.exec(pending))) {
        const frame=pending.slice(0,match.index);pending=pending.slice(match.index+match[0].length);
        const data=frame.split(/\r?\n/).filter(line=>line.startsWith('data:')).map(line=>line.slice(5).replace(/^ /,'')).join('\n');
        if(!data)continue;
        if(data==='[DONE]'){yield null;return;}
        let event;try{event=JSON.parse(data);}catch{throw new ErrorType('Invalid gateway stream JSON.','INVALID_RESPONSE');}
        if(event.error)throw new ErrorType(String(event.error.message||'Gateway failed.'),String(event.error.code||'GATEWAY_ERROR'));
        yield event;
      }
      if(pending.length>2*1024*1024)throw new ErrorType('Gateway event exceeded its size limit.','OUTPUT_LIMIT');
    }
    throw new ErrorType('Gateway stream ended without [DONE].','STREAM_CLOSED');
  } finally { await reader.cancel().catch(()=>{});reader.releaseLock(); }
}
function createAdapter(llm,host,ctx) {
  const {LlmAdapter,LlmError}=llm;
  return new class ShanghaiTechAdapter extends LlmAdapter {
    imageRequestTarget(_provider,_model,image){return imageTarget(image);}
    providerInfo(){return {id:PROVIDER,name:'ShanghaiTech GenAI'};}
    providerRetryPolicy(){return llm.resolveRetryPolicy({mode:'normal',maxRetries:0},'ShanghaiTech GenAI');}
    modelInfo(m){return {provider:PROVIDER,id:m.id,name:m.name,inputModalities:m.attachments.images.supported?['text','image']:['text'],context:{contextWindow:CONTEXT_WINDOWS[m.id]??8192},defaultMaxTokens:4096};}
    async listModels(){return (await host.capabilities()).models.map(m=>this.modelInfo(m));}
    async resolveModel(provider,model,signal){const m=(await host.capabilities(signal)).models.find(m=>m.id===model);if(!m)throw new LlmError('Unknown ShanghaiTech GenAI model.','MODEL_NOT_FOUND');return this.modelInfo(m);}
    async *stream(options) {
      for(const field of ['temperature','stop','reasoningEffort'])if(options[field]!==undefined)throw new LlmError('Unsupported option: '+field,'UNSUPPORTED_OPTION');
      // The agent/request waterfall owns the snapshot for a running step.
      const held=options.sessionId && host.snapshots.get(options.sessionId);
      const flags=held?.model===options.model && (!llm.isAgentLoopRequest || llm.isAgentLoopRequest(options))?held.value:await host.snapshot(options.sessionId,options.model,options.signal);
      const controller=new AbortController();
      const signal=AbortSignal.any([controller.signal,AbortSignal.timeout(330000),...(options.signal?[options.signal]:[])]);
      try {
        const conversation=conversationId(options.sessionId,options.purpose??'chat');
        const request={model:options.model,messages:await messagesOf({...options,signal},ctx,LlmError,llm),stream:true,max_tokens:options.maxTokens??4096,shanghaitech:flags,
          stream_options:{include_usage:true},...conversation?{conversation_id:conversation}:{}};
        if(options.tools?.length) request.tools=options.tools.filter(tool=>tool.deferLoading!==true).map(tool=>({type:'function',function:{name:tool.name,description:tool.description,parameters:tool.parameters}}));
        const response=await host.fetch(gatewayBaseUrl()+'/chat/completions',{method:'POST',headers:{...await host.headers(),'Content-Type':'application/json'},body:JSON.stringify(request),signal,redirect:'error'});
        if(!response.ok){let error;try{error=(await response.json()).error;}catch{}throw new LlmError(error?.message||'Gateway HTTP '+response.status,error?.code||'GATEWAY_HTTP_ERROR');}
        let nextIndex=0,finish,done=false;
        const metadata={};
        const blocks=new Map();
        function block(key,type) {let b=blocks.get(key);if(!b){b={index:nextIndex++,type,text:'',id:'',name:'',arguments:''};blocks.set(key,b);return [b,true];}return [b,false];}
        for await(const event of sse(response,signal,LlmError)) {
          if(event===null){done=true;break;}
          // Metadata can arrive in the finish frame or a later choices:[]
          // usage frame. Handle it before checking for an answer choice.
          collectMetadata(event,metadata);
          const choice=event.choices?.[0];if(!choice)continue;
          if(finish)throw new LlmError('Gateway emitted content after finish.','INVALID_RESPONSE');
          const delta=choice.delta??{};
          for(const [key,type] of [['reasoning_content','reasoning'],['content','text']])if(delta[key]) {
            if(typeof delta[key]!=='string')throw new LlmError('Invalid text delta.','INVALID_RESPONSE');
            const [b,start]=block(key,type);if(start)yield {type:'block-start',index:b.index,blockType:type};
            b.text+=delta[key];yield {type:type==='text'?'text-delta':'reasoning-delta',index:b.index,text:delta[key]};
          }
          for(const call of delta.tool_calls??[]) {
            if(!Number.isSafeInteger(call.index)||call.index<0)throw new LlmError('Invalid tool-call index.','INVALID_RESPONSE');
            const [b,start]=block('tool'+call.index,'tool-call');
            if(start)yield {type:'block-start',index:b.index,blockType:'tool-call'};
            if(call.id)b.id=call.id;if(call.function?.name)b.name+=call.function.name;
            const args=call.function?.arguments??'';if(typeof args!=='string')throw new LlmError('Invalid tool arguments.','INVALID_RESPONSE');
            b.arguments+=args;yield {type:'tool-call-delta',index:b.index,id:b.id,...b.name?{name:b.name}:{},argumentsDelta:args};
          }
          if(choice.finish_reason)finish=choice.finish_reason;
        }
        if(!done||!['stop','length','tool_calls'].includes(finish))throw new LlmError('Gateway did not finish successfully.','STREAM_CLOSED');
        if(!blocks.size)throw new LlmError('Gateway returned an empty response.','EMPTY_RESPONSE');
        for(const b of blocks.values()) {
          let value;
          if(b.type==='tool-call') {if(!b.id||!b.name)throw new LlmError('Incomplete tool call.','INVALID_RESPONSE');try{JSON.parse(b.arguments);}catch{throw new LlmError('Incomplete tool arguments.','INVALID_RESPONSE');}value={type:b.type,id:b.id,name:b.name,arguments:b.arguments};}
          else value={type:b.type,text:b.text};
          yield {type:'block-end',index:b.index,block:value};
        }
        // The SDK has text blocks but no source/citation chunk. Render clearly
        // labelled website data and keep its structured form in ReplayEnvelope.
        const references=options.purpose? '':sourceText(metadata);
        if(references) {
          const index=nextIndex++;
          yield {type:'block-start',index,blockType:'text'};
          yield {type:'text-delta',index,text:references};
          yield {type:'block-end',index,block:{type:'text',text:references}};
        }
        const usage=usageOf(metadata.usage);
        if(usage)yield {type:'usage',usage};
        yield {type:'finish',reason:{kind:finish==='tool_calls'?'tool-calls':finish==='length'?'max-tokens':'stop'},
          replayState:replayState(metadata,options.model,conversation)};
      } catch(e) { if(options.signal?.aborted)throw new LlmError('Request cancelled.','ABORTED');if(signal.aborted)throw new LlmError('Gateway request timed out.','TIMEOUT');throw e; }
      finally {controller.abort();}
    }
  }();
}
module.exports={createAdapter,messagesOf,sse};
