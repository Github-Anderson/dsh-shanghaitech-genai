const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const {File}=require('node:buffer');
function store(value) { const listeners = new Set(); return {getSnapshot:()=>value,set(next){value=next;for(const fn of listeners) fn();},subscribe(fn){listeners.add(fn);return()=>listeners.delete(fn);}}; }
const flush = () => new Promise(resolve => setImmediate(resolve));
async function main(){
 let plugin, component, locales; const registrations=[],effects=[]; let selectedCalls=0, requests=[], reject=false, deferred;
 const caps={models:[{id:'Kimi-k3',search:{supported:true},thinking:{supported:true}},{id:'GPT-6.1-Terra',search:{supported:true},thinking:{supported:true}},{id:'deepseek-pro',search:{supported:true},thinking:{supported:false}}]};
 const saved=new Map();
 const directory=store({current:{provider:'shanghaitech-genai',model:'Kimi-k3',reasoningEffort:'high'},pending:null,status:'ready'});
 const react={createElement:(type,props,...children)=>({type,props,children}),useRef:()=>({current:null}),useState:()=>['',()=>{}],useEffect:()=>{}};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'client.js'),'utf8'),{AbortController,File,queueMicrotask,window:{__ModuleLoader__:{load(row){plugin=row.factory(name=> name==='react'?react:{createSnapshotStore:store});}}}});
 const ctx={modelDirectories:{directoryFor:()=>({store:directory,select(){selectedCalls++;}})},sessions:{scope:()=>({effect:fn=>effects.push(fn())}),subagentAddress:()=>undefined},on:()=>()=>{},effect:fn=>effects.push(fn()),locale:{register:(_ns,value)=>{locales=value;return()=>{};}},slots:{inject:(_n,fn)=>fn(),register:(row,view)=>{component=view;registrations.push(row);}},connection:{rpc:{async call(base,endpoint,payload,signal){
  assert.equal(base,'/api');assert(signal instanceof AbortSignal);requests.push({endpoint,payload});
  if(deferred) await deferred;
  if(reject) return {ok:false,error:{code:'FAILED'}};
  if(endpoint==='shanghaitech.session.delete')return {ok:true,value:{sessionId:payload.sessionId,deleted:true}};
  let row=saved.get(payload.model)||{provider:'shanghaitech-genai',model:payload.model,search:false,thinking:false,revision:0,capabilities:caps};
  if(endpoint.endsWith('.set')){assert.equal(payload.expectedRevision,row.revision);row={...row,search:payload.search,thinking:payload.thinking,revision:row.revision+1};saved.set(payload.model,row);}
  return {ok:true,value:row};
 }}}};
 plugin.apply(ctx);assert.equal(registrations.length,3);
 const gateway=registrations.find(row=>row.name==='plugins.bundle.config');assert.equal(gateway.key,'dsh-shanghaitech-genai');
 const options=registrations.filter(row=>row.name.startsWith('conversation.'));
 const face=options[0].inject('session-1');const other=options[1].inject('session-1');assert.equal(face.hooks.options,other.hooks.options);
 await flush();assert.equal(face.hooks.options.getSnapshot().status,'ready');assert.equal(requests.length,1);
 const leaveHero=face.enterView(), leaveComposer=other.enterView();
 leaveHero();await flush();assert.equal(requests.length,1,'Replacing hero must not reset active options');
 leaveComposer();await flush();
 const leaveRestored=face.enterView();await flush();
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
     const tree=component({useOptions:()=>({...snapshot,value:{...snapshot.value,search:enabled,thinking:enabled}}),t,inputActions:{},selectOptions:face.selectOptions});
     const buttons=tree.children.filter(child=>child?.type==='button');
     assert.deepEqual(buttons.map(b=>b.children[0]),lang==='en'?['Search','Thinking','Attachments','Delete session']:['联网搜索','深度思考','网页附件','删除会话']);
     for(const b of buttons.slice(0,2)){assert.equal(b.props['aria-checked'],enabled);assert(b.props.title);}
     assert(buttons[2].props.title.includes(lang==='en'?'original website':'原网页'));
   }
   for(const key of ['attachmentsNotReady','attachmentsFormat','attachmentsSize','attachmentsLocked'])assert(t(key));
 }
 directory.set({current:{provider:'shanghaitech-genai',model:'deepseek-pro'},pending:null,status:'ready'});await flush();
 const count=requests.length;await face.selectOptions('thinking',true);assert.equal(requests.length,count);
 reject=true;assert.equal(await face.deleteSession(true),false);assert(face.hooks.options.getSnapshot().deleteError);assert(!face.hooks.options.getSnapshot().deleted);
 reject=false;assert.equal(await face.deleteSession(false),true);assert.equal(face.hooks.options.getSnapshot().deleted,true);
 assert.equal(requests.at(-1).endpoint,'shanghaitech.session.delete');assert.equal(requests.at(-1).payload.deleteWebsite,false);
 const afterDelete=requests.length;assert.equal(await face.deleteSession(false),false);assert.equal(requests.length,afterDelete);
 directory.set({current:{provider:'other',model:'x'},pending:null,status:'ready'});assert.equal(face.hooks.options.getSnapshot().visible,false);
 let release;deferred=new Promise(resolve=>release=resolve);
 directory.set({current:{provider:'shanghaitech-genai',model:'Kimi-k3'},pending:null,status:'ready'});
 directory.set({current:{provider:'other',model:'x'},pending:null,status:'ready'});release();await flush();assert.equal(face.hooks.options.getSnapshot().value,null,'Old response cannot restore a different model');
 for(const fn of effects)if(typeof fn==='function')fn();
 console.log('PASS: shared UI store, independent options, no optimistic mutation, failure/reload, model isolation, capability gates, stale response cancellation, lifecycle');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
