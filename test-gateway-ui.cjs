'use strict';
const assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const {GatewaySettings}=require('./gateway-settings.cjs');
const {OptionsHost}=require('./host.cjs');
async function main(){
 let record,component,labels,plugin;
 const fallback='synthetic-current-key-'.repeat(2);
 const credentials={resolve:async()=>({value:fallback}),readRecord:async()=>record,modifyRecord:async(_id,fn)=>{record=await fn(record);}};
 const host=new OptionsHost({credentials},()=>{}),settings=new GatewaySettings(host);
 let values=[],at=0,effects=[],mounted=false;
 const React={createElement:(type,props,...children)=>({type,props:props??{},children}),
  useState(initial){const i=at++;if(!(i in values))values[i]=initial;return[values[i],v=>{values[i]=v;}];},
  useRef(initial){const i=at++;return values[i]??=( {current:initial} );},useId(){return 'field-'+at++;},
  useEffect(fn){if(!mounted)effects.push(fn);}};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'client.js'),'utf8'),{AbortController,window:{__ModuleLoader__:{load(row){plugin=row.factory(n=>n==='react'?React:{});}}}});
 plugin.apply({inject:()=>{},effect:()=>{},locale:{register:(_n,v)=>{labels=v;}},slots:{inject:(_n,fn)=>fn(),register:(row,view)=>{if(row.name==='plugins.bundle.config')component=view;}}});
 // Locale registration is an effect; obtain it without instantiating session controllers.
 plugin.apply({inject:()=>{},effect:fn=>fn(),locale:{register:(_n,v)=>{labels=v;return()=>{};}},slots:{inject:(_n,fn)=>fn(),register:(row,view)=>{if(row.name==='plugins.bundle.config')component=view;}}});
 const props={t:k=>labels.en[k],rpc:async(action,payload)=>({ok:true,value:await settings[action](payload)})};
 function render(){at=0;return component(props);}
 function all(node){return node&&typeof node==='object'?[node,...node.children.flat(Infinity).flatMap(all)]:[];}
 const field=tree=>all(tree).find(n=>n.type==='input'&&n.props.maxLength===4096);
 const toggle=tree=>all(tree).find(n=>n.type==='button'&&n.props['aria-controls']);
 render();mounted=true;effects.forEach(fn=>fn());await new Promise(setImmediate);
 let tree=render();assert.equal(field(tree).props.type,'password');assert.equal(field(tree).props.value,fallback);
 const rotated='synthetic-rotated-key-'.repeat(2);
 await settings.set({address:'example.invalid:9000',apiKey:rotated,revision:'inherited'});
 await toggle(tree).props.onClick();tree=render();assert.equal(field(tree).props.type,'text');assert.equal(field(tree).props.value,rotated);
 assert.equal((await host.headers()).Authorization,'Bearer '+field(tree).props.value);
 await toggle(tree).props.onClick();tree=render();assert.equal(field(tree).props.type,'password');
 const draft='synthetic-new-draft-'.repeat(2);field(tree).props.onChange({target:{value:draft}});tree=render();
 assert.equal((await host.headers()).Authorization,'Bearer '+rotated,'Typing does not change the active key');
 assert(all(tree).some(n=>n.children.includes(labels.en.gatewayUnsaved)));
 await tree.props.onSubmit({preventDefault(){}});tree=render();assert.equal(field(tree).props.type,'password');assert.equal(field(tree).props.value,draft);
 assert.equal((await host.headers()).Authorization,'Bearer '+draft);
 for(const lang of ['zh','en'])for(const k of ['gatewayShowKey','gatewayHideKey','gatewayUnsaved'])assert(labels[lang][k]);
 values=[];mounted=false;effects=[];render();mounted=true;effects.forEach(fn=>fn());await new Promise(setImmediate);
 assert.equal(field(render()).props.type,'password');assert.equal(field(render()).props.value,draft);
 console.log('PASS: masked default, fresh effective-key reveal, hide, unsaved draft isolation, save resets visibility and reopen stays hidden.');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
