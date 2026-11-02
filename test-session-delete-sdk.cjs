// Run with installed Electron-as-Node. Uses only new synthetic storage.
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {createRequire}=require('node:module');
const sdk=path.join(os.homedir(),'AppData/Local/Programs/DeepSeek Harness/resources/app.asar/dsh');
const shipped=createRequire(path.join(sdk,'package.json'));
const {Context}=shipped('@deepseek-ai/cordis');
const {Session,SessionStore,appendPluginRecord}=shipped('@deepseek-ai/dsh-session');
const {AgentRegistry}=shipped('@deepseek-ai/dsh-agent');
const persistence=shipped('@deepseek-ai/dsh-session-persistence-jsonl');
const {SqliteSessionQueryEngine}=shipped('@deepseek-ai/dsh-session-query-sqlite');
const {SessionDeletion,checkedDirectory,recordConversation,RECORD}=require('./session-delete.cjs');
async function scenario(openAt){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'dsh-delete-real-sdk-'));
 const ctx=new Context();
 try{
  await fs.mkdir(path.join(root,'logs'));
  await ctx.plugin(SessionStore).await();await ctx.plugin(AgentRegistry).await();
  const provider=ctx.plugin(persistence,{root:path.join(root,'logs'),compression:'zstd',listConcurrency:3});await provider.await();
  const backend=ctx.sessionPersistence;
  assert.equal(typeof backend.acquireLease,'function');assert(backend.tracker.writers);
  const detached=Session.create('synthetic-delete-real-sdk');
  const header={...detached.header,cwd:root};
  const writer=await backend.create(header);await writer.flush();
  const session=Session.create(header.id,[],header);await writer.append(session.snapshotEvents());ctx.sessions.enter(session);ctx.sessions.announce(session);
  let canceled=false,disposed=false;
  const agent={id:header.id,session,status:'idle',inbox:{hasPending:false},cancel(){canceled=true;},whenIdle:async()=>{},scope:{dispose:async()=>{disposed=true;}}};
  ctx.agents.enter(agent);ctx.agents.announce(agent);
  const members=new Set([header.id]);
  // Only workspace membership is mocked. Search/corpus, storage, routing,
  // handles, kernel semaphore and both registries are the installed SDK.
  ctx.provide('workspaceRegistry',{list:()=>[{get sessionIds(){return [...members];},detachSession:async id=>members.delete(id)}],unpinSession:async()=>{},unarchiveSession:async()=>{}});
  await ctx.plugin(SqliteSessionQueryEngine,{path:':memory:',openAt}).await();
  await recordConversation(ctx,appendPluginRecord,header.id,'dsh-synthetic-purpose');
  await recordConversation(ctx,appendPluginRecord,header.id,'dsh-synthetic-purpose');
  assert.equal(session.snapshotEvents().filter(e=>e.type===RECORD).length,1);
  assert.equal(session.snapshotEvents().at(-1).ignorable,true);
  const directory=await checkedDirectory(backend,header);assert((await fs.stat(directory)).isDirectory());
  const deletion=new SessionDeletion({ctx,snapshots:new Map()});
  if(openAt==='never')await assert.rejects(ctx.sessionQuery.searchSessions({query:'synthetic',limit:1}),e=>e.code==='SESSION_QUERY_SEARCH_DISABLED');
  else {
    await assert.rejects(ctx.sessionQuery.searchSessions({limit:1}),e=>e.code==='SESSION_QUERY_INVALID_QUERY');
    await ctx.sessionQuery.searchSessions({query:'synthetic',limit:1});
    assert.equal(ctx.sessionQuery._db.prepare('SELECT COUNT(*) AS n FROM temp.live_sessions').get().n,1);
  }
  const result=await deletion.remove({sessionId:header.id,deleteWebsite:false});
  assert.equal(result.deleted,true);assert(canceled&&disposed);assert.deepEqual(result.warnings,[]);
  assert.equal(ctx.sessions.get(header.id),undefined);assert.equal(ctx.agents.get(header.id),undefined);
  assert.equal(await backend.stat(header.id),undefined);assert.equal((await backend.list()).length,0);
  assert.equal((await ctx.sessionQuery.listSessions()).length,0);
  if(openAt!=='never'){
    assert.equal(ctx.sessionQuery._db.prepare('SELECT COUNT(*) AS n FROM persisted_sessions').get().n,0);
    assert.equal(ctx.sessionQuery._db.prepare('SELECT COUNT(*) AS n FROM temp.live_sessions').get().n,0);
  }
  else assert.equal(ctx.sessionQuery._db,undefined,'Disabled search must remain closed');
  assert.equal(members.size,0);await assert.rejects(fs.stat(directory),{code:'ENOENT'});
  console.log('PASS: real DSH Zstd deletion, writer/Windows semaphore/registries and SQLite query openAt='+openAt+'; logs, membership and query corpus absent, no false failure.');
 }finally{await ctx.fiber.dispose();await fs.rm(root,{recursive:true,force:true});}
}
(async()=>{await scenario('never');await scenario('startup');})().catch(error=>{console.error(error);process.exitCode=1;});
