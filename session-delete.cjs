// Local permanent deletion adapter for the inspected DSH JSONL backend.
// Backend internals are checked before any remote or local mutation. No archive.
'use strict';
const fs=require('node:fs/promises');
const path=require('node:path');
const {conversationId}=require('./gateway-contract.cjs');
const {gatewayBaseUrl,gatewayConnection}=require('./gateway-url.cjs');
const {readJson}=require('./pdf-reader.cjs');
const RECORD='plugin:shanghaitech-genai/conversation';
const gates=new Set();
const recordLocks=new Map();
async function recordConversation(ctx,append,sessionId,conversation,signal){
  if(!sessionId||!conversation)return;
  if(gates.has(sessionId))fail('session-deleting','This session is being deleted.');
  const work=(recordLocks.get(sessionId)||Promise.resolve()).catch(()=>{}).then(async()=>{
    if(gates.has(sessionId))fail('session-deleting','This session is being deleted.');
    const live=ctx.sessions.get(sessionId);if(!live)return;
    if(!live.snapshotEvents().some(e=>e.type===RECORD&&e.data?.conversation_id===conversation)){
      signal?.throwIfAborted();append(live,RECORD,{version:1,conversation_id:conversation});
      if(!await ctx.sessions.flush(live))fail('persistence-unavailable','Cannot persist the upstream conversation identity.');
    }
  });
  recordLocks.set(sessionId,work);try{return await work;}finally{if(recordLocks.get(sessionId)===work)recordLocks.delete(sessionId);}
}
function fail(code,message){const error=new Error(message);error.code='shanghaitech/'+code;throw error;}
function valid(id){return typeof id==='string' && id.length>0 && id.length<=256 && !/[\x00-\x1f\x7f]/.test(id);}
function requireIdle(ctx,ids){
  for(const id of ids){const agent=ctx.agents.get(id);if(agent && (agent.status==='running'||agent.inbox?.hasPending))fail('session-busy','Stop this session and its subagents before deleting.');}
}
async function checkedDirectory(backend,header){
  const location=backend.locate(header);
  if(location?.kind!=='jsonl'||typeof location.path!=='string'||typeof backend.root!=='string')fail('delete-unsupported','This DSH storage backend does not support permanent deletion.');
  const root=await fs.realpath(backend.root),directory=path.dirname(path.resolve(location.path));
  const segments=path.relative(root,directory).split(path.sep);
  if(segments.length!==2||segments.some(s=>!s||s==='.'||s==='..')||path.isAbsolute(path.relative(root,directory)))fail('delete-path','Refusing a session path outside the storage root.');
  let current=root;
  for(const segment of segments){current=path.join(current,segment);const stat=await fs.lstat(current);if(stat.isSymbolicLink()||!stat.isDirectory())fail('delete-path','Refusing a linked or invalid session directory.');}
  if(await fs.realpath(directory)!==directory)fail('delete-path','Refusing a redirected session directory.');
  const log=await fs.lstat(location.path);
  if(log.isSymbolicLink()||!log.isFile()||!/^session\.v\d+\.jsonl(?:\.zstd)?$/.test(path.basename(location.path)))fail('delete-path','Refusing an unsupported session artifact.');
  return directory;
}
function registryGuard(ctx){
  const backend=ctx.sessionPersistence,registry=ctx.workspaceRegistry;
  if(typeof backend?.locate!=='function'||typeof backend.acquireLease!=='function'||!backend.tracker?.writers||
     typeof ctx.agents?.detachEntered!=='function'||!ctx.agents.store||typeof ctx.sessions?.detachEntered!=='function'||!ctx.sessions.store||
     typeof registry?.list!=='function'||typeof registry.unarchiveSession!=='function'||typeof registry.unpinSession!=='function')
    fail('delete-unsupported','This DSH version does not expose the checked JSONL deletion lifecycle.');
}
async function refreshDeletedSessionIndex(query){
  try {
    // The public search API requires nonempty query text even when the caller
    // only wants reconciliation. Disabled search is a supported DSH deployment.
    await query.searchSessions({query:'DSH_SESSION_DELETION_INDEX_REFRESH',limit:1});
    return [];
  }catch(error){
    if(error?.code==='SESSION_QUERY_SEARCH_DISABLED')return [];
    // The durable logs and workspace membership are already gone. A derived
    // index failure is a warning, not a failed deletion or a reason to retry it.
    return ['search_index_refresh_failed'];
  }
}
class SessionDeletion {
  constructor(host){this.host=host;this.ctx=host.ctx;}
  async track(sessionId,conversation,signal){
    return recordConversation(this.ctx,this.host.append,sessionId,conversation,signal);
  }
  async remove(payload,signal){
    if(!payload||Object.keys(payload).some(k=>!['sessionId','deleteWebsite'].includes(k))||!valid(payload.sessionId)||typeof payload.deleteWebsite!=='boolean')fail('invalid-delete','Supply a session identity and explicit website-deletion choice.');
    registryGuard(this.ctx);
    const ctx=this.ctx,backend=ctx.sessionPersistence;
    const log=await ctx.sessionQuery.readSession(payload.sessionId);
    if(log.session.origin==='subagent')fail('subagent-owned','Delete a subagent with its parent session.');
    const headers=new Map((await backend.list()).map(row=>[row.header.id,row.header]));
    for(const session of ctx.sessions.list())headers.set(session.id,session.header);
    const ids=new Set([payload.sessionId]);
    for(let size=-1;size!==ids.size;){size=ids.size;for(const header of headers.values())if(header.origin==='subagent'&&ids.has(header.parentSession))ids.add(header.id);}
    if([...ids].some(id=>gates.has(id)))fail('session-deleting','This session is already being deleted.');
    requireIdle(ctx,ids);
    for(const id of ids)gates.add(id);
    let websiteConfirmed=false,localLogsRemoved=0;
    try {
      const targets=[];const conversations=new Set();
      for(const id of ids){
        const loaded=id===payload.sessionId?log:await ctx.sessionQuery.readSession(id);
        const live=ctx.sessions.get(id);
        if(live&&!await ctx.sessions.flush(live))fail('persistence-unavailable','Cannot flush the session before deleting.');
        const header=loaded.session;
        const directory=await checkedDirectory(backend,header);
        const agent=ctx.agents.get(id);
        if(agent&&(typeof agent.cancel!=='function'||typeof agent.whenIdle!=='function'||typeof agent.scope?.dispose!=='function'))fail('delete-unsupported','The DSH agent lifecycle changed; deletion was refused.');
        for(const e of loaded.events)if(e.type===RECORD&&valid(e.data?.conversation_id))conversations.add(e.data.conversation_id);
        // Compatibility for pre-update sessions; the gateway refuses unknown
        // mappings rather than guessing which old website conversation to delete.
        if(!loaded.events.some(e=>e.type===RECORD)&&loaded.events.some(e=>e.type==='request/header'&&e.data.header.config.provider==='shanghaitech-genai'))conversations.add(conversationId(id));
        targets.push({id,header,directory,agent});
      }
      requireIdle(ctx,ids);
      signal?.throwIfAborted();
      let website={deleted:false,deleted_groups:0};
      if(payload.deleteWebsite&&conversations.size){
        const connection=await gatewayConnection(this.host.ctx.credentials);
        const response=await this.host.fetch(gatewayBaseUrl(connection)+'/conversations/delete',{
          method:'POST',headers:{...await this.host.headers(connection),'Content-Type':'application/json'},
          body:JSON.stringify({conversation_ids:[...conversations]}),signal:AbortSignal.any([...(signal?[signal]:[]),AbortSignal.timeout(330000)]),redirect:'error'});
        const value=await readJson(response,signal);
        if(!response.ok||value.deleted!==true||value.scope!=='upstream_history_and_gateway_mapping')fail('website-delete-failed','Website deletion was not confirmed; the local session was retained. Retry or explicitly choose local-only deletion.');
        website=value;
      }
      websiteConfirmed=payload.deleteWebsite&&(!conversations.size||website.deleted);
      // After remote confirmation, finish local cleanup despite browser disconnect.
      // Child sessions are removed before their parent. Independent forks survive.
      for(const target of targets.reverse()){
        const {id,header,agent}=target;
        if(agent){agent.cancel({kind:'disposed'});await agent.whenIdle();await agent.scope.dispose();}
        const writer=backend.tracker.writers.get(id);if(writer)await writer.close();
        const lease=await backend.acquireLease(id,header.cwd,target.directory);
        try {
          const directory=await checkedDirectory(backend,header);
          if(directory!==target.directory)fail('delete-path','The session path changed during deletion.');
          // Both absolute root and exact directory have been checked immediately
          // above. Only this backend-owned project/session directory is removed.
          await fs.rm(directory,{recursive:true,force:false});
          localLogsRemoved++;
          backend.coldLogMemo?.delete(id);
        }finally{await lease.release();}
        const agentEntry=ctx.agents.store.get(id);if(agentEntry)ctx.agents.detachEntered(agentEntry);
        const sessionEntry=ctx.sessions.store.get(id);if(sessionEntry)ctx.sessions.detachEntered(sessionEntry);else ctx.emit('api-session/removed',id);
        for(const workspace of ctx.workspaceRegistry.list())if(workspace.sessionIds.includes(id))await workspace.detachSession(id);
        await ctx.workspaceRegistry.unpinSession(id);await ctx.workspaceRegistry.unarchiveSession(id);
        for(const name of ['headers','sessionPaths','missingSessionPaths','invalidSessionPaths'])ctx.workspaceRegistry[name]?.delete(id);
        this.host.snapshots.delete(id);
      }
      const warnings=await refreshDeletedSessionIndex(ctx.sessionQuery);
      return {sessionId:payload.sessionId,deleted:true,local_sessions:targets.length,
        website_deleted:websiteConfirmed,deleted_groups:website.deleted_groups,warnings};
    }catch(error){
      // Never expose raw backend errors or paths. Preserve completed stages so
      // the client does not claim a successful website operation was retained.
      const safe=new Error(websiteConfirmed
        ? 'Website history was deleted, but local cleanup did not finish. Reload before retrying.'
        : 'Session deletion did not finish. Reload before retrying.');
      safe.code=error?.code?.startsWith('shanghaitech/')?error.code:'shanghaitech/local-cleanup-failed';
      safe.deletionProgress={website_deleted:websiteConfirmed,local_logs_removed:localLogsRemoved};
      throw safe;
    }finally{for(const id of ids)gates.delete(id);}
  }
  install(){
    const endpoint='shanghaitech.session.delete';
    this.ctx.effect(()=>this.ctx.connection.fetch.register({path:'/api/'+endpoint,methods:['POST'],requestBody:'buffered',fetch:async request=>{
      let envelope;
      try {
        const raw=await request.text();if(raw.length>4096)fail('invalid-delete','Deletion request is too large.');envelope=JSON.parse(raw);
        if(envelope.type!=='client-request'||typeof envelope.rpcId!=='string'||envelope.method!==endpoint)fail('invalid-delete','Invalid deletion RPC.');
        const value=await this.remove(envelope.payload,request.signal);
        return Response.json({type:'server-response',rpcId:envelope.rpcId,result:{ok:true,value}});
      }catch(e){return Response.json({type:'server-response',rpcId:envelope?.rpcId??'invalid-request',result:{ok:false,error:{code:e.code?.startsWith('shanghaitech/')?e.code:'shanghaitech/delete-failed',message:e.code?.startsWith('shanghaitech/')?e.message:'Deletion did not complete. Reload the session before retrying.',details:e.deletionProgress??{}}}});}
    }}),'ShanghaiTech: permanent session deletion');
    this.ctx.on('agent/request',async({agent},next)=>{if(gates.has(agent.session.id))fail('session-deleting','This session is being deleted.');return next();});
  }
}
module.exports={SessionDeletion,checkedDirectory,recordConversation,refreshDeletedSessionIndex,RECORD};
