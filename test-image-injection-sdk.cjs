'use strict';
// Real Cordis service guard and image helpers; synthetic bytes, no file/network I/O.
const assert = require('node:assert/strict');
const {createRequire} = require('node:module');
const shipped = createRequire(require('node:path').join(process.env.DSH_TEST_SDK_ROOT || require('node:path').join(require('node:os').homedir(),'AppData/Local/Programs/DeepSeek Harness/resources/app.asar/dsh'),'package.json'));
const {Context} = shipped('@deepseek-ai/cordis');
const llm = shipped('@deepseek-ai/dsh-llm');
const path = require('node:path');
const pluginDir = process.argv[2] || __dirname;
const plugin = require(path.join(pluginDir, 'index.cjs'));
const {messagesOf} = require(path.join(pluginDir, 'adapter.cjs'));
async function main() {
  assert(plugin.inject.includes('fs'), 'Image path mapping requires an explicit fs injection');
  const root = new Context();
  const ref = {attachmentId:'sha256:synthetic', mediaType:'image/png', width:500, height:280, bytes:8};
  const data = new Uint8Array([137,80,78,71,13,10,26,10]);
  let mapped = 0, reads = 0;
  for (const name of plugin.inject) root.provide(name, name === 'fs' ? {
    processPathFromHostPath(value) { assert.equal(value, 'synthetic-host-image'); mapped++; return 'synthetic-workspace-image'; }
  } : name === 'attachments' ? {
    imageHostPath(value) { assert.equal(value, ref); return 'synthetic-host-image'; },
    async readImageRequest() { reads++; return {data, mediaType:'image/png', width:500, height:280, bytes:8}; }
  } : {});
  let resolve, reject;
  const done = new Promise((yes, no) => {resolve=yes; reject=no;});
  root.plugin({inject:plugin.inject, apply(ctx) {
    messagesOf({messages:[{role:'user',content:[{type:'image',attachment:ref}]}]},ctx,llm.LlmError,llm).then(resolve,reject);
  }});
  try {
    const out = await done;
    assert.equal(mapped,1);
    assert.equal(reads,1);
    assert(out[0].content.some(part => part.type === 'image_url' && part.image_url.url.endsWith(Buffer.from(data).toString('base64'))));
    console.log('PASS: production injection declaration, real Cordis fs guard, native image access helper and image serialization');
  } finally { await root.fiber.dispose(); }
}
main().catch(error => {console.error(error); process.exitCode=1;});
