'use strict';
const PROVIDER = 'shanghaitech-genai';
const {gatewayBaseUrl, gatewayConnection, DEFAULT_BASE_URL: BASE} = require('./gateway-url.cjs');
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
      const previous=pending??selected;
      if(saved && previous && (previous.provider!==config.provider || previous.model!==config.model))saved={...saved,thinking:false};
      if(e.type==='model/selection') pending=config;
      else { selected=config; if(pending?.provider===config.provider && pending.model===config.model && pending.reasoningEffort===config.reasoningEffort)pending=undefined; }
    }
    if (e.type===RECORD && e.data?.version===1 && typeof e.data.search==='boolean' && typeof e.data.thinking==='boolean') saved={...e.data,thinking:e.data.model===model && e.data.thinking};
  }
  return {selected:pending??selected,saved};
}
class OptionsHost {
  constructor(ctx, append, attribution = () => ({}), fetchImpl = fetch) {
    this.ctx=ctx; this.append=append; this.attribution=attribution; this.fetch=fetchImpl;
    this.locks=new Map(); this.steps=new WeakMap(); this.capabilityCache=null;
    this.optionResets=new Map(); this.viewSearch=false;
  }
  async headers(connection) {
    const key=await gatewayApiKey(this.ctx.credentials, connection);
    return {...this.attribution(),Authorization:'Bearer '+key};
  }
  async capabilities(signal, connection, refresh=false) {
    signal?.throwIfAborted();
    connection ??= await gatewayConnection(this.ctx.credentials);
    const baseUrl=gatewayBaseUrl(connection);
    if (!refresh && this.capabilityCache?.baseUrl===baseUrl && this.capabilityCache.revision===connection?.revision && Date.now()-this.capabilityCache.time<15000) return this.capabilityCache.value;
    const response=await this.fetch(baseUrl+'/capabilities'+(refresh?'?refresh=true':''),{headers:await this.headers(connection),signal:AbortSignal.any([...(signal?[signal]:[]),AbortSignal.timeout(10000)]),redirect:'error'});
    if (!response.ok) fail('Gateway capabilities unavailable (HTTP '+response.status+').','shanghaitech/gateway-unavailable');
    const value=await response.json();
    if (value.protocol_version!=='1.1' || !Array.isArray(value.models)) fail('Upgrade the Docker gateway to protocol 1.1.','shanghaitech/protocol-mismatch');
    if(value.conversations?.request_field!=='conversation_id' || !['after_chat_completion','stream_metadata'].includes(value.options?.sources_phase) ||
       value.usage?.stream_opt_in!=='stream_options.include_usage') fail('Rebuild the Docker gateway with conversation, source and usage support.','shanghaitech/protocol-mismatch');
    this.capabilityCache={time:Date.now(),value,baseUrl,revision:connection?.revision}; return value;
  }
  async state(sessionId, model, signal, connection) {
    identity(sessionId,model);
    const [caps, log]=await Promise.all([this.capabilities(signal,connection),this.ctx.sessionQuery.readSession(sessionId)]);
    signal?.throwIfAborted();
    const entry=caps.models.find(m=>m.id===model); if(!entry) fail('Model is not in the gateway catalog.');
    let {selected,saved}=fold(log.events,model);
    selected = this.ctx.agents?.get(sessionId)?.model?.current() ?? selected ?? this.ctx.agentDefaultModel?.currentSelection();
    const reset=this.optionResets.get(sessionId);
    if(reset && (saved?.revision??0)<=reset.revision)saved={...saved,search:reset.search,thinking:false};
    const flags=[entry.search.default,entry.thinking.default];
    return {provider:PROVIDER,model,search:saved?.search ?? Boolean(flags[0]),thinking:entry.thinking.supported && (saved?.thinking ?? Boolean(flags[1])),revision:saved?.revision ?? 0,capabilities:caps,selected,session:log.session};
  }
  async get(payload,signal) {
    let state=await this.state(payload.sessionId,payload.model,signal);
    if(state.session.origin==='subagent')fail('Subagent options are owned by its parent.');
    if(payload.activate===true) {
      this.optionResets.set(payload.sessionId,{revision:state.revision,search:this.viewSearch});
      state=await this.state(payload.sessionId,payload.model,signal);
    }
    const {selected,session,...publicState}=state; return publicState;
  }
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
      // Resolve the Host-owned writer without the model picker's profile default update.
      const resolved = await this.ctx.sessionController.resolveAgent(key);
      if ('error' in resolved) throw resolved.error;
      const admitted=await this.state(key,payload.model,signal);
      if(admitted.selected?.provider!==PROVIDER || admitted.selected.model!==payload.model) fail('The selected model changed. Reload its options.','shanghaitech/model-changed');
      if(admitted.revision!==current.revision) fail('Options changed while acquiring the session writer. Reload and retry.','shanghaitech/revision-conflict');
      const live=this.ctx.sessions.get(key);
      if(!live) fail('Open this conversation before changing options.');
      signal?.throwIfAborted();
      this.append(live,RECORD,{version:1,model:payload.model,search:payload.search,thinking:payload.thinking,revision:current.revision+1});
      try {if(!await this.ctx.sessions.flush(live)) fail('No session persistence writer is available.','shanghaitech/persistence-unavailable');}
      catch(error) {
        // Compensate in the append-only log: a failed save must not become an active option.
        this.append(live,RECORD,{version:1,model:payload.model,search:current.search,thinking:current.thinking,revision:current.revision+2});
        throw error;
      }
      this.viewSearch=payload.search;
      return this.get(payload,signal);
    });
  }
  async snapshot(sessionId,model,signal,connection) {
    return this.serial(sessionId??'',()=>this.snapshotUnlocked(sessionId,model,signal,new Set(),connection));
  }
  async snapshotUnlocked(sessionId,model,signal,visited=new Set(),connection) {
    if(!sessionId) {const cap=(await this.capabilities(signal,connection)).models.find(m=>m.id===model);if(!cap)fail('Unknown gateway model.');return {search:Boolean(cap.search.default),thinking:Boolean(cap.thinking.default)};}
    const current=await this.state(sessionId,model,signal,connection);
    if(current.session.origin==='subagent' && current.session.parentSession) {
      if(visited.has(sessionId))fail('Invalid parent-session cycle.');visited.add(sessionId);
      return this.snapshotUnlocked(current.session.parentSession,model,signal,visited,connection);
    }
    const flags=[current.search,current.thinking];
    const snapshot={search:Boolean(flags[0]),thinking:Boolean(flags[1])};
    const live=this.ctx.sessions.get(sessionId);
    if(current.revision===0 && live) this.append(live,RECORD,{version:1,model,...snapshot,revision:1});
    if(live && !await this.ctx.sessions.flush(live))fail('Options cannot be persisted.');
    return Object.freeze(snapshot);
  }
  stepOptions({sessionId, model, signal}) {
    const step = this.steps.get(signal);
    return step && step.sessionId === sessionId && step.model === model ? step.flags : undefined;
  }
  install(runtimeVersion) {
    const {SessionDeletion}=require('./session-delete.cjs');
    this.deletion=new SessionDeletion(this, runtimeVersion);
    this.trackConversation=(...args)=>this.deletion.track(...args);
    this.deletion.install();
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
    this.ctx.on('agent/created', ({agent, source, signal}) => {
      if (source !== 'resume' || !agent.model) return;
      const current = agent.model.current();
      if (current?.provider !== PROVIDER || current.reasoningEffort === undefined) return;
      const {selected} = fold(agent.session.snapshotEvents(), current.model);
      if (selected?.provider !== PROVIDER || selected.model !== current.model ||
          selected.reasoningEffort !== current.reasoningEffort) return;
      signal?.throwIfAborted();
      // This adapter has never offered a native effort. Remove the persisted
      // legacy carrier before the restored Agent can prepare its first step.
      agent.model.select({provider: current.provider, model: current.model});
    });
    this.ctx.on('agent/pre-step', async ({agent, modelSelection, signal}, next) => {
      const sessionId = agent.session.id;
      this.deletion.assertNotDeleting(sessionId);
      this.steps.delete(signal);
      const decision = await next();
      if (decision.kind !== 'enter') return decision;
      const selection = modelSelection ?? agent.model?.current() ?? agent.options;
      if (selection?.provider === PROVIDER) {
        const flags = await this.snapshot(sessionId, selection.model, signal);
        this.steps.set(signal, {sessionId, model: selection.model, flags});
      }
      return decision;
    });
    // The 0.2.1 RCs have no Agent.model. Their request hook is the only
    // existing path for stripping an effort before the old LLM validator.
    if (/^0\.2\.1-rc\.[2-5]$/.test(runtimeVersion)) {
      this.ctx.on('agent/request', async (_event, next) => {
        const config = await next();
        if (config.provider !== PROVIDER || config.reasoningEffort === undefined) return config;
        const {reasoningEffort, ...selection} = config;
        return selection;
      });
    }
    this.ctx.on('session/disposed', session => this.optionResets.delete(session.id));
  }
}
module.exports={OptionsHost,fold,BASE,PROVIDER,RECORD};
