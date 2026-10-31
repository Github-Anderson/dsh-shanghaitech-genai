'use strict';
const assert = require('node:assert/strict');
const {gatewayBaseUrl, DEFAULT_BASE_URL} = require('./gateway-url.cjs');
const {OptionsHost} = require('./host.cjs');
const {createAdapter} = require('./adapter.cjs');
async function main() {
  assert.equal(gatewayBaseUrl({}), DEFAULT_BASE_URL);
  for (const [input, expected] of [
    ['http://localhost:8123', 'http://localhost:8123/v1'],
    ['https://example.invalid/proxy/v1/', 'https://example.invalid/proxy/v1'],
    ['https://example.invalid/proxy', 'https://example.invalid/proxy/v1'],
    ['http://[::1]:8000/v1', 'http://[::1]:8000/v1'],
  ]) {
    assert.equal(gatewayBaseUrl({SHANGHAITECH_GENAI_BASE_URL: input}), expected);
  }
  for (const input of ['', 'invalid', 'file:///tmp/key', 'https://user:secret@example.invalid', 'https://example.invalid/?key=secret', 'https://example.invalid/#secret']) {
    assert.throws(() => gatewayBaseUrl({SHANGHAITECH_GENAI_BASE_URL: input}), error => !error.message.includes('secret') && /HTTP\(S\)/.test(error.message));
  }
  const original = process.env.SHANGHAITECH_GENAI_BASE_URL;
  process.env.SHANGHAITECH_GENAI_BASE_URL = 'https://example.invalid/proxy/v1/';
  try {
    const urls = [];
    const host = new OptionsHost({credentials:{resolve:async()=>({value:'synthetic'})}}, ()=>{}, ()=>{}, async url => {
      urls.push(url);
      if (url.endsWith('/capabilities')) return Response.json({protocol_version:'1.1', models:[], conversations:{request_field:'conversation_id'}, options:{sources_phase:'after_chat_completion'}, usage:{stream_opt_in:'stream_options.include_usage'}});
      return new Response('data: {"choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n');
    });
    await host.capabilities();
    host.snapshot = async()=>({search:false,thinking:false});
    const adapter = createAdapter({LlmAdapter:class{}, LlmError:Error}, host, {});
    for await (const _ of adapter.stream({model:'deepseek-pro',messages:[{role:'user',content:[{type:'text',text:'synthetic'}]}]})) {}
    assert.deepEqual(urls, ['https://example.invalid/proxy/v1/capabilities','https://example.invalid/proxy/v1/chat/completions']);
  } finally {
    if (original === undefined) delete process.env.SHANGHAITECH_GENAI_BASE_URL;
    else process.env.SHANGHAITECH_GENAI_BASE_URL = original;
  }
  console.log('PASS: URL normalization, secret-safe rejection and custom capability/chat routing');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
