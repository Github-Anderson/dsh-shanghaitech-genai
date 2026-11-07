const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const {File}=require('node:buffer');
function store(value) { const listeners = new Set(); return {getSnapshot:()=>value,set(next){value=next;for(const fn of listeners) fn();},subscribe(fn){listeners.add(fn);return()=>listeners.delete(fn);}}; }
const flush = () => new Promise(resolve => setImmediate(resolve));
async function main(){
 let plugin, locales, command, menu; const registrations=new Map(),effects=[],notices=[]; let selectedCalls=0, requests=[], reject=false, deferred;
 const caps={models:[{id:'Kimi-k3',search:{supported:true},thinking:{supported:true}},{id:'GPT-6.1-Terra',search:{supported:true},thinking:{supported:true}},{id:'deepseek-pro',search:{supported:true},thinking:{supported:false}}]};
 const saved=new Map();
 const directory=store({current:{provider:'shanghaitech-genai',model:'Kimi-k3',reasoningEffort:'high'},pending:null,status:'ready'});
 const react={createElement:(type,props,...children)=>({type,props,children}),useRef:()=>({current:null}),useState:()=>['',()=>{}],useEffect:()=>{}};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'client.js'),'utf8'),{AbortController,File,queueMicrotask,window:{__ModuleLoader__:{load(row){plugin=row.factory(name=> name==='react'?react:{createSnapshotStore:store});}}}});
 const ctx={inject:(_services,apply)=>apply(ctx),commandUi:{register(row){command=row;}},contextMenus:{
  register(row){menu=row;}, notify(message,success){notices.push({message,success});}
 },modelDirectories:{directoryFor:()=>({store:directory,select(){selectedCalls++;}})},sessions:{scope:()=>({effect:fn=>effects.push(fn())}),subagentAddress:()=>undefined},on:()=>()=>{},effect:fn=>effects.push(fn()),locale:{bind:()=>key=>locales.en[key],register:(_ns,value)=>{locales=value;return()=>{};}},slots:{inject:(_n,fn)=>fn(),register:(row,view)=>registrations.set(row.name,{...row,view})},connection:{rpc:{async call(base,endpoint,payload,signal){
  assert.equal(base,'/api');assert(signal instanceof AbortSignal);requests.push({endpoint,payload});
  if(deferred) await deferred;
  if(reject) return {ok:false,error:{code:'FAILED'}};
  if(endpoint==='shanghaitech.session.deleteEligibility')return {ok:true,value:{eligible:payload.sessionId==='session-2'}};
  if(endpoint==='shanghaitech.session.delete')return {ok:true,value:{sessionId:payload.sessionId,deleted:true}};
  let row=saved.get(payload.model)||{provider:'shanghaitech-genai',model:payload.model,search:false,thinking:false,revision:0,capabilities:caps};
  if(endpoint.endsWith('.set')){assert.equal(payload.expectedRevision,row.revision);row={...row,search:payload.search,thinking:payload.thinking,revision:row.revision+1};saved.set(payload.model,row);}
  return {ok:true,value:row};
 }}}};
 plugin.apply(ctx);
 assert.equal(registrations.get('plugins.bundle.config').key,'dsh-shanghaitech-genai');
 assert.deepEqual([...registrations.keys()].filter(name=>name.startsWith('conversation.')),['conversation.input.left']);
 const options=registrations.get('conversation.input.left');
 const face=options.inject('session-1');
 await flush();assert.equal(face.hooks.options.getSnapshot().status,'ready');assert.equal(requests.length,1);
 assert.equal(command.name,'shanghaitech-attach');
 assert.equal(command.available({sessionId:'session-1'}),false);
 let picks=0;
 const leaveComposer=face.enterView(()=>{picks++;});
 assert.equal(command.available({sessionId:'session-1'}),true);
 assert.equal(command.available({sessionId:'session-2'}),false);
 command.ui.run({sessionId:'session-2'});
 command.ui.run({sessionId:'session-1'});assert.equal(picks,1);
 leaveComposer();await flush();
 assert.equal(command.available({sessionId:'session-1'}),false);
 const leaveRestored=face.enterView(()=>{});await flush();
 assert.equal(requests.at(-1).payload.activate,true,'Reopening an existing view resets its transient options');
 leaveRestored();
 let draftFiles,releaseCount=0,draftSeq=0;
 ctx.conversation={createDrafts:(id,files)=>{assert.equal(id,'session-1');draftFiles=files;return files.map((file,i)=>({id:'draft-'+draftSeq++,file}));},releaseDraftAttachments:()=>{releaseCount++;}};
 let removed=[];
 const picked=[new File(['GIF89a'],'animated.gif',{type:'image/gif'}),new File(['marker'],'one.txt',{type:'text/plain'})];
 let ids;face.addWebsiteAttachments(picked,{addAttachments:value=>{ids=value;return true;},removeAttachment:id=>removed.push(id)});
 assert.deepEqual(Array.from(ids),['draft-0','draft-1']);assert(draftFiles.every(file=>file.type==='application/octet-stream'));
 assert.equal(await draftFiles[0].text(),'GIF89a');assert.equal(draftFiles[0].name,'animated.gif');
 for(const ext of ['md','markdown','log','htm'])face.addWebsiteAttachments([new File(['text'],'file.'+ext)],{addAttachments:()=>true});
 assert.throws(()=>face.addWebsiteAttachments([new File(['# no'],'one.doc')],{addAttachments:()=>true}),/attachmentsFormat/);
 assert.throws(()=>face.addWebsiteAttachments(picked,{addAttachments:()=>false}),/attachmentsLocked/);assert.equal(releaseCount,1);
 for(const option of ['search','thinking']){await face.selectOptions(option,true);assert.equal(face.hooks.options.getSnapshot().value[option],true);}
 assert.equal(selectedCalls,0,'Never encode flags in model/effort selection');
 const before=requests.length;await face.selectOptions('bogus',true);assert.equal(requests.length,before);
 reject=true;await face.selectOptions('search',false);assert.equal(face.hooks.options.getSnapshot().value.search,true);assert.equal(face.hooks.options.getSnapshot().status,'error');
 reject=false;await face.reload();assert.equal(face.hooks.options.getSnapshot().status,'ready');
 directory.set({current:{provider:'shanghaitech-genai',model:'GPT-6.1-Terra'},pending:null,status:'ready'});await flush();
 assert.deepEqual(removed,['draft-0','draft-1'],'Model changes clear website draft attachments');
 await face.selectOptions('thinking',true);assert.equal(face.hooks.options.getSnapshot().value.thinking,true);
 for(const lang of ['en','zh']){
   const t=key=>{assert.equal(typeof locales[lang][key],'string','Every rendered string is translated');return locales[lang][key];};
   for(const enabled of [false,true]){
     const snapshot=face.hooks.options.getSnapshot();
     const tree=options.view({useOptions:()=>({...snapshot,value:{...snapshot.value,search:enabled,thinking:enabled}}),t,inputActions:{},selectOptions:face.selectOptions});
     const buttons=tree.children.filter(child=>child?.type==='button');
     assert.deepEqual(buttons.map(b=>b.children[0]),lang==='en'?['Search','Thinking']:['联网搜索','深度思考']);
     for(const b of buttons.slice(0,2)){assert.equal(b.props['aria-checked'],enabled);assert(b.props.title);}
     assert(tree.children.some(child=>child?.type==='input'&&child.props.type==='file'));
   }
   for(const key of ['attachmentsNotReady','attachmentsFormat','attachmentsSize','attachmentsLocked'])assert(t(key));
 }
 directory.set({current:{provider:'shanghaitech-genai',model:'deepseek-pro'},pending:null,status:'ready'});await flush();
 const count=requests.length;await face.selectOptions('thinking',true);assert.equal(requests.length,count);
 assert.equal(menu.target,'session');
 const signal=new AbortController().signal;
 assert.equal((await menu.resolve({sessionId:'session-1'},signal)).length,0);
 const items=await menu.resolve({sessionId:'session-2',displayTitle:'Second session'},signal);
 assert.equal(items[0].label,'Delete session');
 const dialog=registrations.get('shell.overlay').inject();
 const current=()=>dialog.hooks.deletion.getSnapshot();
 items[0].run();assert.equal(current().title,'Second session');assert.equal(current().deleteWebsite,true);
 dialog.dismiss();
 assert.equal(current(),null);assert(!requests.some(row=>row.endpoint==='shanghaitech.session.delete'));
 items[0].run();
 reject=true;await dialog.confirm();assert.equal(current().error.label,'deleteFailed');
 reject=false;dialog.setDeleteWebsite(false);
 let finishDelete;deferred=new Promise(resolve=>finishDelete=resolve);
 const confirm=dialog.confirm();
 assert.equal(current().deleting,true);dialog.dismiss();assert(current());
 const afterDelete=requests.length;await dialog.confirm();assert.equal(requests.length,afterDelete);
 finishDelete();await confirm;deferred=null;
 assert.equal(current(),null);
 assert.equal(requests.at(-1).endpoint,'shanghaitech.session.delete');
 assert.equal(requests.at(-1).payload.sessionId,'session-2','Deletes the clicked sidebar row, not the open composer');
 assert.equal(requests.at(-1).payload.deleteWebsite,false);
 assert.deepEqual(notices,[{message:'Session deleted.',success:true}]);
 directory.set({current:{provider:'other',model:'x'},pending:null,status:'ready'});assert.equal(face.hooks.options.getSnapshot().visible,false);
 let release;deferred=new Promise(resolve=>release=resolve);
 directory.set({current:{provider:'shanghaitech-genai',model:'Kimi-k3'},pending:null,status:'ready'});
 directory.set({current:{provider:'other',model:'x'},pending:null,status:'ready'});release();await flush();assert.equal(face.hooks.options.getSnapshot().value,null,'Old response cannot restore a different model');
 for(const fn of effects)if(typeof fn==='function')fn();
 console.log('PASS: single composer, attachment command, captured delete target, option state and lifecycle');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
