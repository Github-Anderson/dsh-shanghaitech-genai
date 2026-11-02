// Synthetic local files only; no user sessions and no live website requests.
'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {SessionDeletion,checkedDirectory,RECORD}=require('./session-delete.cjs');
const {conversationId}=require('./gateway-contract.cjs');
async function fixture(){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'dsh-delete-synthetic-'));
 const logs=new Map(),writers=new Map(),entries=new Map(),agents=new Map(),calls=[],removed=[];
 for(const id of ['parent','child','sibling']){
   const header={id,origin:id==='child'?'subagent':'user',...(id==='child'?{parentSession:'parent'}:{}),cwd:root};
   const directory=path.join(root,'project',id);await fs.mkdir(directory,{recursive:true});await fs.writeFile(path.join(directory,'session.v4.jsonl'),'synthetic');
   logs.set(id,{session:header,events:[{type:RECORD,data:{version:1,conversation_id:conversationId(id)}}]});
   entries.set(id,{id});writers.set(id,{close:async()=>{removed.push('close:'+id);writers.delete(id);}});
   agents.set(id,{id,agent:{status:'idle',inbox:{hasPending:false},cancel:()=>removed.push('cancel:'+id),whenIdle:async()=>{},scope:{dispose:async()=>removed.push('scope:'+id)}}});
 }
 const backend={root,tracker:{writers},coldLogMemo:new Map(),locate:h=>({kind:'jsonl',path:path.join(root,'project',h.id,'session.v4.jsonl')}),
   list:async()=>Array.from(logs.values(),log=>({header:log.session})),acquireLease:async id=>{removed.push('lease:'+id);return {release:async()=>removed.push('release:'+id)};}};
 const membership=new Set(logs.keys());let reconciled=0;
 const ctx={sessionPersistence:backend,agents:{store:agents,get:id=>agents.get(id)?.agent,detachEntered:e=>{agents.delete(e.id);removed.push('agent:'+e.id);}},
  sessions:{store:entries,list:()=>Array.from(entries.keys(),id=>({id,header:logs.get(id).session})),get:()=>undefined,detachEntered:e=>{entries.delete(e.id);removed.push('detach:'+e.id);}},
  sessionQuery:{readSession:async id=>logs.get(id),searchSessions:async()=>{reconciled++;return {items:[]};}},
  workspaceRegistry:{list:()=>[{get sessionIds(){return [...membership];},detachSession:async id=>membership.delete(id)}],unpinSession:async()=>{},unarchiveSession:async()=>{}},emit:(name,id)=>removed.push(name+':'+id)};
 const host={ctx,snapshots:new Map(),headers:async()=>({Authorization:'Bearer synthetic'}),fetch:async(url,init)=>{calls.push({url,init});return Response.json({deleted:true,deleted_groups:2,scope:'upstream_history_and_gateway_mapping'});}};
 return {root,logs,ctx,host,calls,removed,membership,get reconciled(){return reconciled;},deletion:new SessionDeletion(host),cleanup:()=>fs.rm(root,{recursive:true,force:true})};
}
test('permanent local + website deletion removes subtree, preserves sibling and reconciles index',async()=>{
 const f=await fixture();try{
  const result=await f.deletion.remove({sessionId:'parent',deleteWebsite:true});
  assert.equal(result.local_sessions,2);assert.equal(result.website_deleted,true);assert.equal(f.reconciled,1);
  for(const id of ['parent','child'])await assert.rejects(fs.stat(path.join(f.root,'project',id)),{code:'ENOENT'});
  assert((await fs.stat(path.join(f.root,'project','sibling'))).isDirectory());
  assert.deepEqual([...f.membership],['sibling']);assert.deepEqual([...f.ctx.agents.store.keys()],['sibling']);
  assert.equal(f.calls.length,1);assert.equal(f.calls[0].init.method,'POST');
  assert.deepEqual(new Set(JSON.parse(f.calls[0].init.body).conversation_ids),new Set([conversationId('parent'),conversationId('child')]));
  for(const id of ['parent','child'])assert(f.removed.indexOf('close:'+id)<f.removed.indexOf('lease:'+id));
 }finally{await f.cleanup();}
});
test('explicit local-only delete never resolves credentials or calls website',async()=>{
 const f=await fixture();try{f.host.headers=()=>{throw Error('Must not read credentials');};const result=await f.deletion.remove({sessionId:'parent',deleteWebsite:false});assert.equal(result.deleted,true);assert.equal(result.website_deleted,false);assert.equal(f.calls.length,0);}finally{await f.cleanup();}
});
test('website failure retains all local logs and membership; subsequent retry works',async()=>{
 const f=await fixture();try{const fetch=f.host.fetch;f.host.fetch=async()=>Response.json({error:{code:'conversation_mapping_missing'}},{status:404});
  await assert.rejects(f.deletion.remove({sessionId:'parent',deleteWebsite:true}),e=>e.code==='shanghaitech/website-delete-failed');
  assert((await fs.stat(path.join(f.root,'project','parent'))).isDirectory());assert.equal(f.removed.length,0);assert.equal(f.membership.size,3);
  f.host.fetch=fetch;assert((await f.deletion.remove({sessionId:'parent',deleteWebsite:true})).deleted);
 }finally{await f.cleanup();}
});
test('active child, subagent direct delete and unsupported storage fail before side effects',async()=>{
 const f=await fixture();try{
  f.ctx.agents.get('child').status='running';await assert.rejects(f.deletion.remove({sessionId:'parent',deleteWebsite:true}),e=>e.code==='shanghaitech/session-busy');
  f.ctx.agents.get('child').status='idle';await assert.rejects(f.deletion.remove({sessionId:'child',deleteWebsite:true}),e=>e.code==='shanghaitech/subagent-owned');
  delete f.ctx.sessionPersistence.acquireLease;await assert.rejects(f.deletion.remove({sessionId:'parent',deleteWebsite:true}),e=>e.code==='shanghaitech/delete-unsupported');assert.equal(f.calls.length,0);assert.equal(f.removed.length,0);
 }finally{await f.cleanup();}
});
test('path escape and junction are refused without removing outside files',async()=>{
 const f=await fixture(),outside=await fs.mkdtemp(path.join(os.tmpdir(),'dsh-delete-outside-'));try{
  const header=f.logs.get('parent').session;f.ctx.sessionPersistence.locate=()=>({kind:'jsonl',path:path.join(outside,'session.v4.jsonl')});
  await assert.rejects(checkedDirectory(f.ctx.sessionPersistence,header),e=>e.code==='shanghaitech/delete-path');
  const link=path.join(f.root,'project','linked');await fs.symlink(outside,link,'junction');f.ctx.sessionPersistence.locate=()=>({kind:'jsonl',path:path.join(link,'session.v4.jsonl')});
  await assert.rejects(checkedDirectory(f.ctx.sessionPersistence,header),e=>e.code==='shanghaitech/delete-path');assert((await fs.stat(outside)).isDirectory());
 }finally{await f.cleanup();await fs.rm(outside,{recursive:true,force:true});}
});

test('disabled full-text search does not turn completed deletion into failure',async()=>{
 const f=await fixture();try{
  f.ctx.sessionQuery.searchSessions=async request=>{assert.equal(typeof request.query,'string');assert(request.query.trim());const error=Error('disabled');error.code='SESSION_QUERY_SEARCH_DISABLED';throw error;};
  const result=await f.deletion.remove({sessionId:'parent',deleteWebsite:true});
  assert.equal(result.deleted,true);assert.equal(result.website_deleted,true);assert.deepEqual(result.warnings,[]);
  await assert.rejects(fs.stat(path.join(f.root,'project','parent')),{code:'ENOENT'});
 }finally{await f.cleanup();}
});
test('failed disposable index yields a warning after confirmed local and website deletion',async()=>{
 const f=await fixture();try{
  f.ctx.sessionQuery.searchSessions=async request=>{assert(request.query.trim());throw Error('synthetic private backend detail');};
  const result=await f.deletion.remove({sessionId:'parent',deleteWebsite:true});
  assert.equal(result.deleted,true);assert.equal(result.website_deleted,true);assert.deepEqual(result.warnings,['search_index_refresh_failed']);
  assert(!JSON.stringify(result).includes('private'));assert.equal(f.membership.size,1);
 }finally{await f.cleanup();}
});
test('local cleanup error preserves confirmed website progress without leaking backend text',async()=>{
 const f=await fixture();try{
  f.ctx.sessionPersistence.acquireLease=async()=>{throw Error('synthetic private lock path');};
  await assert.rejects(f.deletion.remove({sessionId:'parent',deleteWebsite:true}),error=>{
   assert.equal(error.code,'shanghaitech/local-cleanup-failed');assert.equal(error.deletionProgress.website_deleted,true);
   assert.equal(error.deletionProgress.local_logs_removed,0);assert(!error.message.includes('private'));return true;
  });
  assert.equal(f.calls.length,1);assert((await fs.stat(path.join(f.root,'project','parent'))).isDirectory());
 }finally{await f.cleanup();}
});
