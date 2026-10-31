'use strict';
const {createHash}=require('node:crypto');

function conversationId(sessionId, purpose='chat', documentDigest) {
  if (sessionId === undefined || sessionId === null) return undefined;
  if (typeof sessionId !== 'string' || !sessionId || sessionId.length > 256) throw Error('Invalid DSH session identity.');
  // Session IDs, subagents and auxiliary calls must not share an upstream group.
  return 'dsh-v1-'+createHash('sha256').update(JSON.stringify([sessionId,purpose,documentDigest??null])).digest('hex');
}
const count=value=>Number.isSafeInteger(value)&&value>=0;
function usageOf(value) {
  if (!value || !count(value.prompt_tokens) || !count(value.completion_tokens)) return undefined;
  const result={inputTokens:value.prompt_tokens,outputTokens:value.completion_tokens};
  if(count(value.total_tokens))result.totalTokens=value.total_tokens;
  const read=value.prompt_tokens_details?.cached_tokens;
  const write=value.prompt_tokens_details?.created_cache_tokens;
  // DSH's pi-ai adapter splits cached input from uncached input. Do not add
  // cache counters on top of the prompt count and thereby double count it.
  if ((read===undefined||count(read)) && (write===undefined||count(write)) &&
      (read??0)+(write??0)<=value.prompt_tokens) {
    result.inputTokens-= (read??0)+(write??0);
    if(read!==undefined)result.cacheReadTokens=read;
    if(write!==undefined)result.cacheWriteTokens=write;
  }
  const reasoning=value.completion_tokens_details?.reasoning_tokens;
  if(count(reasoning))result.reasoningTokens=reasoning;
  return result;
}
function rawUsage(value) {
  if(!usageOf(value))return undefined;
  const result={prompt_tokens:value.prompt_tokens,completion_tokens:value.completion_tokens};
  if(count(value.total_tokens))result.total_tokens=value.total_tokens;
  for(const [key,names] of [['prompt_tokens_details',['cached_tokens','created_cache_tokens']],
                           ['completion_tokens_details',['reasoning_tokens']]]) {
    const details={};for(const name of names)if(count(value[key]?.[name]))details[name]=value[key][name];
    if(Object.keys(details).length)result[key]=details;
  }
  return result;
}
function sourcesOf(value) {
  if(!value || !Array.isArray(value.links) || value.links.length>100 || !count(value.count))throw Error('Invalid sources.');
  const links=value.links.map(row=>{
    if(!row || !count(row.num) || typeof row.title!=='string' || row.title.length>1000 ||
       typeof row.link!=='string' || row.link.length>4096 || /[\s\x00-\x1f\x7f]/.test(row.link) ||
       typeof row.snippet!=='string' || row.snippet.length>10000)throw Error('Invalid source.');
    const url=new URL(row.link);
    if(!['http:','https:'].includes(url.protocol)||!url.hostname||url.username||url.password)throw Error('Invalid source URL.');
    return {num:row.num,title:row.title,link:url.href,snippet:row.snippet};
  });
  return {links,count:value.count};
}
function collectMetadata(event,state) {
  if(event.usage!==undefined) {
    const usage=rawUsage(event.usage);
    if(usage)state.usage=usage;
  }
  const value=event.shanghaitech;
  if(!value||typeof value!=='object')return;
  if(value.upstream_metadata && typeof value.upstream_metadata==='object') {
    const counters={};
    for(const key of ['totalTokens','promptTokens','completionTokens'])if(count(value.upstream_metadata[key]))counters[key]=value.upstream_metadata[key];
    if(Object.keys(counters).length)state.upstream_metadata=counters;
  }
  if(value.sources_status==='ready') {
    try {state.sources=sourcesOf(value.sources);state.sources_status='ready';delete state.sources_error;}
    catch {state.sources_status='failed';state.sources_error='sources_protocol_error';delete state.sources;}
  } else if(value.sources_status==='failed') {
    state.sources_status='failed';delete state.sources;
    state.sources_error=typeof value.sources_error==='string'&&/^[a-z0-9_]{1,128}$/.test(value.sources_error)?value.sources_error:'sources_unavailable';
  }
}
function escapeMarkdown(text) {return text.replace(/[\r\n]/g,' ').replace(/[\\`*_{}\[\]()<>#+.!|~\-]/g,'\\$&');}
function sourceText(state) {
  if(state.sources_status==='failed')return '\n\n搜索来源获取失败；以上回答已保留。';
  if(state.sources_status!=='ready')return '';
  if(!state.sources.links.length)return '\n\n搜索来源：本轮未返回来源链接。';
  return '\n\n搜索来源（网站返回）\n\n'+state.sources.links.map((row,index)=>
    `${index+1}. [${escapeMarkdown(row.title||new URL(row.link).hostname)}](<${row.link.replace(/[<>]/g,c=>c==='<'?'%3C':'%3E')}>)`).join('\n');
}
function replayState(state, model, conversation) {
  const response={kind:'shanghaitech',version:1,model,...conversation?{conversation_id:conversation}:{},...state};
  return {response};
}
module.exports={conversationId,usageOf,collectMetadata,sourceText,replayState};
