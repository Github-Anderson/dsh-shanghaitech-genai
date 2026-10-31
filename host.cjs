'use strict';
const PROVIDER = 'shanghaitech-genai';
const {gatewayBaseUrl, DEFAULT_BASE_URL: BASE} = require('./gateway-url.cjs');
const RECORD = 'plugin:shanghaitech-genai/options';
const {gatewayApiKey} = require('./gateway-credentials.cjs');
function fail(message, code = 'shanghaitech/invalid-options') { const e = new Error(message); e.code=code; throw e; }
function identity(id, model) {
  if (typeof id !== 'string' || !id || id.length > 256 || typeof model !== 'string' || !model || model.length > 128) fail('Invalid session/model identity.');
}
function fold(events, model) {
  let selected, saved, pending;
  for (const e of events) {
    const config = e.type === 'model/selection' ? e.data : e.type === 'request/header' ? e.data.header.config : undefined;
    if (config) {
      if(e.type==='model/selection') pending=config;
      else { selected=config; if(pending?.provider===config.provider && pending.model===config.model && pending.reasoningEffort===config.reasoningEffort)pending=undefined; }
    }
    if (e.type===RECORD && e.data?.version===1 && e.data.model===model && typeof e.data.search==='boolean' && typeof e.data.thinking==='boolean') saved=e.data;
  }
  return {selected:pending??selected,saved};
}
class OptionsHost {
  constructor(ctx, append, attribution = () => ({}), fetchImpl = fetch) {
    this.ctx=ctx; this.append=append; this.attribution=attribution; this.fetch=fetchImpl;
    this.locks=new Map(); this.snapshots=new Map(); this.capabilityCache=null;
  }
  async headers() {
    const key=await gatewayApiKey(this.ctx.credentials);
    return {...this.attribution(),Authorization:'Bearer '+key};
  }
  async capabilities(signal) {
    signal?.throwIfAborted();
    if (this.capabilityCache && Date.now()-this.capabilityCache.time<15000) return this.capabilityCache.value;
    const response=await this.fetch(gatewayBaseUrl()+'/capabilities',{headers:await this.headers(),signal:AbortSignal.any([...(signal?[signal]:[]),AbortSignal.timeout(10000)]),redirect:'error'});
    if (!response.ok) fail('Gateway capabilities unavailable (HTTP '+response.status+').','shanghaitech/gateway-unavailable');
    const value=await response.json();
    if (value.protocol_version!=='1.1' || !Array.isArray(value.models)) fail('Upgrade the Docker gateway to protocol 1.1.','shanghaitech/protocol-mismatch');
    if(value.conversations?.request_field!=='conversation_id' || value.options?.sources_phase!=='after_chat_completion' ||
       value.usage?.stream_opt_in!=='stream_options.include_usage') fail('Rebuild the Docker gateway with conversation, source and usage support.','shanghaitech/protocol-mismatch');
    this.capabilityCache={time:Date.now(),value}; return value;
  }
  async state(sessionId, model, signal) {
    identity(sessionId,model);
    const [caps, log]=await Promise.all([this.capabilities(signal),this.ctx.sessionQuery.readSession(sessionId)]);
    signal?.throwIfAborted();
    const entry=caps.models.find(m=>m.id===model); if(!entry) fail('Model is not in the gateway catalog.');
    let {selected,saved}=fold(log.events,model);
    selected ??= this.ctx.agentDefaultModel?.currentSelection();
    const flags=[entry.search.default,entry.thinking.default];
    return {provider:PROVIDER,model,search:saved?.search ?? Boolean(flags[0]),thinking:entry.thinking.supported && (saved?.thinking ?? Boolean(flags[1])),revision:saved?.revision ?? 0,capabilities:caps,selected,session:log.session};
  }
  async get(payload,signal) { const state=await this.state(payload.sessionId,payload.model,signal); if(state.session.origin==='subagent')fail('Subagent options are owned by its parent.'); const {selected,session,...publicState}=state; return publicState; }
  async serial(key,fn) {
    const work=(this.locks.get(key)||Promise.resolve()).catch(()=>{}).then(fn);
    this.locks.set(key,work);try{return await work;}finally{if(this.locks.get(key)===work)this.locks.delete(key);}
  }
  async set(payload,signal) {
    identity(payload.sessionId,payload.model);
    const key=payload.sessionId;
    return this.serial(key,async()=>{
      if(Object.keys(payload).some(k=>!['sessionId','model','search','thinking','expectedRevision'].includes(k)) || typeof payload.search!=='boolean' || typeof payload.thinking!=='boolean' || !Number.isSafeInteger(payload.expectedRevision)) fail('Invalid options update.');
      const current=await this.state(key,payload.model,signal);
      if(current.session.origin==='subagent')fail('Subagent options are owned by its parent.');
      if(current.selected?.provider!==PROVIDER || current.selected.model!==payload.model) fail('The selected model changed. Reload its options.','shanghaitech/model-changed');
      if(current.revision!==payload.expectedRevision) fail('Options changed in another view. Reload and retry.','shanghaitech/revision-conflict');
      const cap=current.capabilities.models.find(m=>m.id===payload.model);
      if(payload.search&&!cap.search.supported || payload.thinking&&!cap.thinking.supported) fail('This model does not support the selected option.');
      // Use the public command on every explicit save: it acquires/resumes the
      // normal Agent writer and clears the obsolete effort from native selection.
      // Read legacy flags above before removing that carrier.
      await this.ctx.sessionController.selectModel({sessionId:key,provider:PROVIDER,model:payload.model});
      const live=this.ctx.sessions.get(key);
      if(!live) fail('Open this conversation before changing options.');
      const admitted=await this.state(key,payload.model,signal);
      if(admitted.selected?.provider!==PROVIDER || admitted.selected.model!==payload.model) fail('The selected model changed. Reload its options.','shanghaitech/model-changed');
      if(admitted.revision!==current.revision) fail('Options changed while acquiring the session writer. Reload and retry.','shanghaitech/revision-conflict');
      signal?.throwIfAborted();
      this.append(live,RECORD,{version:1,model:payload.model,search:payload.search,thinking:payload.thinking,revision:current.revision+1});
      try {if(!await this.ctx.sessions.flush(live)) fail('No session persistence writer is available.','shanghaitech/persistence-unavailable');}
      catch(error) {
        // Compensate in the append-only log: a failed save must not become an active option.
        this.append(live,RECORD,{version:1,model:payload.model,search:current.search,thinking:current.thinking,revision:current.revision+2});
        throw error;
      }
      return this.get(payload,signal);
    });
  }
  async snapshot(sessionId,model,signal) {
    return this.serial(sessionId??'',()=>this.snapshotUnlocked(sessionId,model,signal));
  }
  async snapshotUnlocked(sessionId,model,signal,visited=new Set()) {
    if(!sessionId) {const cap=(await this.capabilities(signal)).models.find(m=>m.id===model);if(!cap)fail('Unknown gateway model.');return {search:Boolean(cap.search.default),thinking:Boolean(cap.thinking.default)};}
    const current=await this.state(sessionId,model,signal);
    if(current.session.origin==='subagent' && current.session.parentSession) {
      if(visited.has(sessionId))fail('Invalid parent-session cycle.');visited.add(sessionId);
      return this.snapshotUnlocked(current.session.parentSession,model,signal,visited);
    }
    const flags=[current.search,current.thinking];
    const snapshot={search:Boolean(flags[0]),thinking:model==='Kimi-k3' && Boolean(flags[1])};
    const live=this.ctx.sessions.get(sessionId);
    if(current.revision===0 && live) this.append(live,RECORD,{version:1,model,...snapshot,revision:1});
    if(live && !await this.ctx.sessions.flush(live))fail('Options cannot be persisted.');
    return Object.freeze(snapshot);
  }
  install() {
    for(const action of ['get','set']) {
      const endpoint='shanghaitech.options.'+action;
      this.ctx.effect(()=>this.ctx.connection.fetch.register({path:'/api/'+endpoint,methods:['POST'],requestBody:'buffered',fetch:async request=>{
        let envelope;
        try {
          const body=await request.text(); if(body.length>4096)fail('Options request too large.'); envelope=JSON.parse(body);
          if(envelope.type!=='client-request'||typeof envelope.rpcId!=='string'||envelope.method!==endpoint||!envelope.payload||Array.isArray(envelope.payload))fail('Invalid RPC request.');
          const value=await this[action](envelope.payload,request.signal);
          return Response.json({type:'server-response',rpcId:envelope.rpcId,result:{ok:true,value}});
        }catch(e){return Response.json({type:'server-response',rpcId:envelope?.rpcId ?? 'invalid-request',result:{ok:false,error:{code:e.code||'shanghaitech/unavailable',message:e.code?e.message:'Options could not be loaded or saved. Check the gateway and session writer.',details:{}}}});}
      }}),'ShanghaiTech GenAI options '+action);
    }
    this.ctx.on('agent/request',async({agent,signal},next)=>{
      const config=await next(); if(config.provider!==PROVIDER)return config;
      const snapshot=await this.snapshot(agent.session.id,config.model,signal);
      this.snapshots.set(agent.session.id,{model:config.model,value:snapshot});
      const {reasoningEffort,...clean}=config; return clean;
    });
    this.ctx.on('session/disposed',session=>this.snapshots.delete(session.id));
  }
}
module.exports={OptionsHost,fold,BASE,PROVIDER,RECORD};
