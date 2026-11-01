'use strict';
const {AsyncLocalStorage}=require('node:async_hooks');
const {createHash}=require('node:crypto');
const {gatewayBaseUrl}=require('./gateway-url.cjs');
const {gatewayApiKey}=require('./gateway-credentials.cjs');
const {conversationId}=require('./gateway-contract.cjs');
const requests=new AsyncLocalStorage();
const MAX_BYTES=20*1024*1024;
const DOCUMENT_TYPES={'.pdf':'application/pdf','.txt':'text/plain','.csv':'text/csv','.docx':'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls':'application/vnd.ms-excel','.xlsx':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.ppt':'application/vnd.ms-powerpoint','.pptx':'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.html':'text/html','.json':'application/json'};

// Capture typed references before DSH unconditionally projects them to text.
// Never infer filesystem access from model/user text that resembles a handle.
function installAttachmentRouting(ctx) {
  ctx.on('llm/stream',(options,next)=>{
    if(options.provider!=='shanghaitech-genai')return next();
    const handles=new Map();
    for(const message of options.messages)for(const [index,block] of message.content.entries()) {
      // Button uploads are receipt-admitted user/file blocks. @path references
      // and tool observations never grant this automatic-upload capability.
      if(message.role==='user'&&message.source?.kind==='user'&&block.type==='file')
        handles.set(message.id+':'+index,{ref:block.attachment,text:ctx.llm.fileRequestText(block.attachment)});
    }
    if(!handles.size)return next();
    return (async function*(){
      const iterator=next()[Symbol.asyncIterator]();
      try {
        while(true){const item=await requests.run(handles,()=>iterator.next());if(item.done)return;yield item.value;}
      }finally{await requests.run(handles,()=>iterator.return?.());}
    })();
  });
}

async function uploadedFilePart(text,options,ctx,ErrorType=Error,message,index) {
  const entry=requests.getStore()?.get(message?.id+':'+index);
  if(!entry||entry.text!==text)return null;
  const ref=entry.ref;
  options.signal?.throwIfAborted();
  const hostPath=ctx.attachments.fileHostPath(ref);
  const path=hostPath===undefined?undefined:ctx.fs.processPathFromHostPath(hostPath);
  if(!path)throw new ErrorType('DSH cannot access the uploaded attachment in this execution environment.','ATTACHMENT_ACCESS_DENIED');
  const target=await ctx.fs.resolve(path,{signal:options.signal});
  const info=await ctx.fs.stat(target,options.signal);
  if(info.type!=='file'||info.size>=MAX_BYTES||ref.bytes>=MAX_BYTES)throw new ErrorType('Website images must be below 20 MiB; documents below 10 MiB.','UNSUPPORTED_CONTENT');
  const data=await ctx.fs.readBytes(target,options.signal,MAX_BYTES);
  if(data.length>MAX_BYTES||data.length!==ref.bytes||'sha256:'+createHash('sha256').update(data).digest('hex')!==ref.attachmentId)
    throw new ErrorType('The uploaded attachment failed its size or digest check.','ATTACHMENT_INTEGRITY_ERROR');
  const bytes=Buffer.from(data);
  const imageMime=bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))?'image/png':
    bytes[0]===255&&bytes[1]===216&&bytes[2]===255?'image/jpeg':
    bytes.subarray(0,4).toString()==='RIFF'&&bytes.subarray(8,12).toString()==='WEBP'?'image/webp':
    ['GIF87a','GIF89a'].includes(bytes.subarray(0,6).toString())?'image/gif':null;
  const suffix=require('node:path').extname(ref.name??'').toLowerCase();
  const mime=imageMime??DOCUMENT_TYPES[suffix];
  if(!mime)throw new ErrorType('Verified website documents: PDF, TXT, CSV, DOCX, XLS, XLSX, PPT, PPTX, HTML, JSON. Other formats are unconfirmed or unsupported; use @path for local file operations.','UNSUPPORTED_CONTENT');
  if(!imageMime&&bytes.length>=10*1024*1024)throw new ErrorType('Website documents must be below 10 MiB.','UNSUPPORTED_CONTENT');
  const key=await gatewayApiKey(ctx.credentials);
  const form=new FormData();
  form.set('model',options.model);form.set('purpose','user_data');
  form.set('include_content','false');
  const conversation=conversationId(options.sessionId,options.purpose??'chat');
  if(conversation)form.set('conversation_id',conversation);
  // DSH display names are untrusted; avoid leaking paths to upstream.
  form.set('file',new Blob([data],{type:mime}),'attachment'+(imageMime?{ 'image/png':'.png','image/jpeg':'.jpg','image/webp':'.webp','image/gif':'.gif'}[imageMime]:suffix));
  const response=await fetch(gatewayBaseUrl()+'/files',{method:'POST',headers:{Authorization:'Bearer '+key},body:form,signal:options.signal,redirect:'error'});
  if(!response.ok){
    let code;try{code=(await require('./pdf-reader.cjs').readJson(response,options.signal)).error?.code;}catch{}
    const reasons={document_content_limit:'The website rejected the document content length; use a shorter document.',document_text_unavailable:'The website returned no text; scanned documents are unsupported.',upstream_upload_size_limit:'The website rejected the upload size including multipart overhead; use a smaller file.'};
    throw new ErrorType(reasons[code]??('Website attachment upload failed (gateway HTTP '+response.status+').'),typeof code==='string'&&/^[a-z_]{1,80}$/.test(code)?code:'ATTACHMENT_UPLOAD_FAILED');
  }
  // Use the existing bounded response reader; never buffer an unlimited reply.
  const result=await require('./pdf-reader.cjs').readJson(response,options.signal);
  if(result.kind!==(imageMime?'image':'document')||result.model!==options.model||result.status!=='ready'||result.sha256!==ref.attachmentId.slice(7)||typeof result.id!=='string'||!result.id||!Number.isSafeInteger(result.expires_at)||result.expires_at<=Date.now()/1000)
    throw new ErrorType('Gateway returned invalid attachment metadata.','ATTACHMENT_UPLOAD_FAILED');
  return {type:'file',file:{file_id:result.id}};
}
module.exports={installAttachmentRouting,uploadedFilePart};
