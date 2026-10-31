'use strict';
// Run with the installed DSH's Electron-as-Node. No commands or model requests.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {createRequire}=require('node:module');
const sdkRoot=process.env.DSH_TEST_SDK_ROOT||path.join(require('node:os').homedir(),'AppData/Local/Programs/DeepSeek Harness/resources/app.asar/dsh');
const shipped=createRequire(path.join(sdkRoot,'package.json'));
const {Context}=shipped('@deepseek-ai/cordis');
const {PluginPackages,createRuntimeResolution,ProfileRuntimeResolution}=shipped('@deepseek-ai/dsh-app-boot');
const {AgentPresetRegistry,entryListProblem}=shipped('@deepseek-ai/dsh-agent-preset-registry');
const {entryListSchema}=shipped('@deepseek-ai/cordis-plugin-include');
const include=createRequire(shipped.resolve('@deepseek-ai/cordis-plugin-include/package.json'));
const {load,dump}=include('js-yaml');
const {isJsExpr}=shipped('@deepseek-ai/cordis-plugin-loader');
async function main(){
 const webManifest=shipped('@deepseek-ai/dsh-web-app/package.json');
 const webRoot=path.dirname(shipped.resolve('@deepseek-ai/dsh-web-app/package.json'));
 const files=webManifest.dsh.bundle.patch;
 const patches=(Array.isArray(files)?files:[files]).flatMap(file=>load(fs.readFileSync(path.resolve(webRoot,file),'utf8'),{schema:entryListSchema}));
 const inserts=patches.flatMap(p=>p.insert||[]);
 const standard=inserts.find(row=>row.config?.id==='standard');
 assert(standard,'Installed DSH must declare the Standard preset.');
 const document=await AgentPresetRegistry.prototype.readDocument.call({definitions:new Map([['standard',{config:standard.config}]])},'standard');
 const declared=standard.config.plugins;
 const baseline=dump(declared,{schema:entryListSchema,noRefs:true});
 const pluginDir=path.resolve(process.argv[2]||__dirname);
 const patch=load(fs.readFileSync(path.join(pluginDir,'cordis.patch.yml'),'utf8'),{schema:entryListSchema});
 const customRows=patch.flatMap(p=>p.insert||[]);
 assert.equal(customRows.find(r=>r.id==='shanghaitech-genai-agent').name,'dsh-shanghaitech-genai/agent-preset');
 assert.equal(customRows.length,2,'Only the model adapter and Agent preset are registered.');
 const root=new Context();
 // Use the SDK's production package resolver, including its CJS interception.
 const testHome=path.resolve(__dirname,'../../../../artifacts/preset-test-home');
 const installed=await createRuntimeResolution({installAnchor:path.join(sdkRoot,'package.json'),home:testHome});
 const profileDir=path.resolve(pluginDir,'..');
 const resolution=new ProfileRuntimeResolution({installAnchor:path.join(sdkRoot,'package.json'),profileDir,home:testHome},{...installed,profileDir,localPackageNames:['dsh-shanghaitech-genai'],entries:[...installed.entries,{name:'dsh-shanghaitech-genai',packageDir:pluginDir,scope:'profile',version:'1.0.0'}]});
 const packages=new PluginPackages(root,{resolution});
 let captured,dispose;let disposed=false;
 try{
  const plugin=require(path.join(pluginDir,'agent-preset.cjs'));
  await plugin.apply({agentPresets:{readDocument:async id=>{assert.equal(id,'standard');return document;},register:async value=>{assert.equal(entryListProblem(value.plugins),undefined);captured=value;return async()=>{disposed=true;};}},effect:fn=>{dispose=fn();}});
  assert.equal(captured.id,'shanghaitech-genai');
  assert.equal(captured.name,'ShanghaiTech GenAI');
  assert.equal(dump(captured.plugins.slice(0,-1),{schema:entryListSchema,noRefs:true}),baseline,'All native config and expression gates must survive the official YAML roundtrip.');
  assert.equal(captured.plugins.length,declared.length+1);
  const flatten=rows=>rows.flatMap(row=>[row,...(row.group?flatten(row.config):[])]);
  const rows=flatten(captured.plugins);
  for(const name of ['dsh-tool-pwsh','dsh-tool-bash','dsh-tool-fs','dsh-tool-jobs'])assert(rows.some(row=>row.name==='@deepseek-ai/'+name),name+' must be retained');
  const pwsh=rows.find(row=>row.name==='@deepseek-ai/dsh-tool-pwsh');
  assert(isJsExpr(pwsh.disabled),'The native platform gate must remain an unevaluated SDK expression.');
  assert.equal(rows.filter(row=>row.name==='dsh-shanghaitech-genai/pdf-reader').length,1);
  assert(!rows.some(row=>row.name==='dsh-shanghaitech-genai/text-only'),'Text-only restrictions must not enter the Agent preset.');
  await dispose();assert(disposed);
  console.log(JSON.stringify({status:'PASS',sdk:'installed DSH',standard_plugin_rows:declared.length,agent_plugin_rows:captured.plugins.length,checks:['real Standard declaration','real registry document serializer','production SDK package resolution','production plugin apply','complete Standard composition and platform gates preserved','command/file/job plugins retained','PDF added once','text-only preset isolated','disposal'],real_commands_executed:0,upstream_inference_requests:0}));
 }finally{await root.fiber.dispose();void packages;}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
