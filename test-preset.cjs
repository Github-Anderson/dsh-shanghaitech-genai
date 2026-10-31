'use strict';
const assert=require('node:assert/strict');
const {definitionFromStandard,registerPreset}=require('./agent-preset.cjs');
const parse=JSON.parse;
const rows=[{id:'native-tools',name:'official-tools',config:{approval:'unchanged'}}];
const document={agentPreset:'standard',content:JSON.stringify(rows)};
async function main(){
 const definition=definitionFromStandard(document,parse);
 assert.equal(definition.id,'shanghaitech-genai');
 assert.deepEqual(definition.plugins.slice(0,-1),rows);
 assert.equal(definition.plugins.at(-1).name,'dsh-shanghaitech-genai/pdf-reader');
 assert.throws(()=>definitionFromStandard({...document,agentPreset:'other'},parse),/unavailable/);
 for(const value of ['[]','null','{}'])assert.throws(()=>definitionFromStandard({...document,content:value},parse),/no plugin composition/);
 let reads=0,waits=0,registered=0,disposed=0,cleanup;
 const ctx={agentPresets:{
  readDocument:async()=>{if(++reads<3)throw Object.assign(Error('not yet registered'),{code:'agent-preset/not-found'});return document;},
  register:async value=>{registered++;assert.deepEqual(value,definition);return async()=>{disposed++;};}
 },effect:fn=>{cleanup=fn();}};
 await registerPreset(ctx,parse,async ms=>{waits++;assert.equal(ms,100);});
 assert.equal(reads,3);assert.equal(waits,2);assert.equal(registered,1);assert.equal(disposed,0);
 await cleanup();assert.equal(disposed,1);
 reads=0;ctx.agentPresets.readDocument=async()=>{reads++;throw Object.assign(Error('missing'),{code:'agent-preset/not-found'});};
 await assert.rejects(registerPreset(ctx,parse,async()=>{}),/missing/);assert.equal(reads,50);assert.equal(registered,1);
 reads=0;ctx.agentPresets.readDocument=async()=>{reads++;throw Error('read failed');};
 await assert.rejects(registerPreset(ctx,parse,async()=>assert.fail('must not retry unrelated errors')),/read failed/);assert.equal(reads,1);
 console.log('PASS: Standard composition copied, PDF appended, invalid/missing Standard fails, startup retry bounded, native disposer retained.');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
