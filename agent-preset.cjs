'use strict';

function definitionFromStandard(document, parse) {
  if(document?.agentPreset!=='standard' || typeof document.content!=='string')throw Error('The standard Agent preset is unavailable.');
  const plugins=parse(document.content);
  if(!Array.isArray(plugins)||!plugins.length)throw Error('The standard Agent preset has no plugin composition.');
  // Presets are sibling scopes, not subclasses of Standard. Copy its public
  // declared composition, preserving native !!js platform gates and settings.
  return {id:'shanghaitech-genai',name:'ShanghaiTech GenAI',order:89,
    description:'Standard Agent 工具与权限流程，增加 ShanghaiTech GenAI PDF 解析。',
    plugins:[...plugins,{id:'shanghaitech-genai-pdf-reader',name:'dsh-shanghaitech-genai/pdf-reader'}]};
}

async function registerPreset(ctx, parse, wait=ms=>new Promise(resolve=>setTimeout(resolve,ms))) {
  let document;
  for(let attempt=0;attempt<50;attempt++) {
    try {document=await ctx.agentPresets.readDocument('standard');break;}
    catch(error) {if(error.code!=='agent-preset/not-found'||attempt===49)throw error;await wait(100);}
  }
  const definition=definitionFromStandard(document,parse);
  const dispose=await ctx.agentPresets.register(definition);
  ctx.effect(()=>dispose,'ShanghaiTech Standard-derived Agent preset');
}

exports.name='shanghaitech-agent-preset';
exports.inject=['agentPresets'];
exports.apply=async function(ctx) {
  const {createRequire}=require('node:module');
  // Reuse the parser and entry schema shipped with this SDK; never evaluate
  // a YAML expression here. The Loader owns expression evaluation at mount.
  const sdk=createRequire(require.resolve('@deepseek-ai/cordis-plugin-include/package.json'));
  const {load}=sdk('js-yaml');
  const {entryListSchema}=sdk('@deepseek-ai/cordis-plugin-include');
  await registerPreset(ctx,text=>load(text,{schema:entryListSchema}));
};
exports.definitionFromStandard=definitionFromStandard;
exports.registerPreset=registerPreset;
