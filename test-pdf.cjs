// Offline contract checks. Network calls are replaced; no user documents read.
const assert = require('node:assert/strict');
const {createHash} = require('node:crypto');
const plugin = require('./pdf-reader.cjs');
const {gatewayBaseUrl} = require('./gateway-url.cjs');
const {conversationId}=require('./gateway-contract.cjs');
const source = Buffer.from('%PDF-1.7\nsynthetic fixture');
const digest = createHash('sha256').update(source).digest('hex');
const capabilities = {protocol_version: '1.1', models: [{id: 'deepseek-pro', attachments: {pdf: {supported: true}}}], files: {max_bytes: 10485760}};
const ready = {kind: 'document', model: 'deepseek-pro', status: 'ready', parsed_content: 'Synthetic extracted marker', sha256: digest, expires_at: Math.floor(Date.now() / 1000) + 3600};
const originalFetch = global.fetch;
let checks = 0;

function fixture({bytes = source, cap = capabilities, result = ready, size = bytes.length, readError, response, key = 'synthetic-key', sessionId} = {}) {
  let definition, prompt, presented;
  const calls = [];
  const signal = new AbortController().signal;
  const agent=sessionId?{session:{id:sessionId}}:'agent';
  plugin.apply({
    tools: {presentAs: value => {presented = value;}, register: value => {definition = value;}},
    systemPrompt: {getSectionOrder: () => 10, section: value => {prompt = value.text;}},
    workingDirectory: {ensure: async (passedAgent, passed) => {assert.equal(passedAgent, agent); assert.equal(passed, signal); return '/work';}},
    fs: {
      resolve: async (value, options) => {assert.equal(options.cwd, '/work'); assert.equal(options.signal, signal); if (readError) throw Error(readError); return value;},
      stat: async () => ({type: 'file', size}),
      readBytes: async (_value, passed, limit) => {assert.equal(passed, signal); assert.equal(limit, 10485760); return bytes;},
    },
    credentials: {resolve: async name => {assert.equal(name, 'SHANGHAITECH_GENAI_API_KEY'); return {value: key};}},
  });
  global.fetch = async (url, options) => {
    assert(url.startsWith(gatewayBaseUrl() + '/'), 'PDF must use the configured gateway URL');
    calls.push({url, options});
    assert.equal(options.signal, signal);
    assert.equal(options.redirect, 'error');
    assert.deepEqual(options.headers, {Authorization: 'Bearer synthetic-key'});
    if (response) return response(url, options);
    return Response.json(url.endsWith('/capabilities') ? cap : result);
  };
  return {definition, calls, prompt, presented, signal, run: args => definition.execute(args ?? {file_path: '/stored/sha256-hash'}, {agent, signal})};
}

async function rejected(options, pattern, calls) {
  const f = fixture(options);
  await assert.rejects(f.run(), pattern);
  assert.equal(f.calls.length, calls);
  checks++;
}

async function main() {
  let f = fixture();
  const output = await f.run();
  assert.equal(f.presented, 'native');
  assert(f.prompt.includes('Other file reads and terminal commands remain available'));
  assert.equal(f.calls.length, 2);
  assert.equal(f.calls[0].url, gatewayBaseUrl() + '/capabilities');
  assert.equal(f.calls[1].url, gatewayBaseUrl() + '/files');
  assert.equal(f.calls[1].options.body.get('model'), 'deepseek-pro');
  assert.equal(f.calls[1].options.body.get('purpose'), 'user_data');
  assert.equal(f.calls[1].options.body.get('file').type, 'application/pdf');
  assert(output.includes(digest));
  assert(output.includes('extracted_text_only'));
  assert(output.includes('Synthetic extracted marker'));
  assert(!output.includes('synthetic-key'));
  checks++;
  f=fixture({sessionId:'pdf-session'});await f.run();
  assert.equal(f.calls[1].options.body.get('conversation_id'),conversationId('pdf-session','pdf-extract',digest));
  assert.notEqual(f.calls[1].options.body.get('conversation_id'),conversationId('pdf-session'));checks++;
  await rejected({bytes: Buffer.from('not a PDF')}, /not a PDF/, 0);
  await rejected({readError: 'Sandbox denied'}, /Sandbox denied/, 0);
  await rejected({size: 10485761}, /at most 10 MiB/, 0);
  await rejected({key: ''}, /credential/, 0);
  await rejected({cap: {...capabilities, models: []}}, /contract/, 1);
  await rejected({cap: {...capabilities, protocol_version: '0.1'}}, /contract/, 1);
  await rejected({cap: {...capabilities, files: {max_bytes: 5}}}, /size limit/, 1);
  await rejected({result: {...ready, sha256: 'different'}}, /mismatched/, 2);
  await rejected({result: {...ready, expires_at: 1}}, /expired/, 2);
  await rejected({result: {...ready, status: 'processing'}}, /ready/, 2);
  await rejected({result: {...ready, parsed_content: ''}}, /ready/, 2);
  await rejected({result: {...ready, model: 'Kimi-k3'}}, /ready/, 2);
  await rejected({response: async () => new Response('error', {status: 503})}, /HTTP 503/, 1);
  await rejected({response: async () => new Response('bad json')}, /invalid JSON/, 1);
  await rejected({response: async () => new Response('x'.repeat(2097153))}, /exceeds/, 1);
  f = fixture({result: {...ready, parsed_content: '😀'.repeat(16001)}});
  let page = await f.run({file_path: '/stored/hash', max_chars: 16000});
  assert(page.includes('"next_start_char":16000'));
  assert(page.includes('PARTIAL DOCUMENT'));
  page = await f.run({file_path: '/stored/hash', start_char: 16000});
  assert(page.endsWith('😀'));
  assert(page.includes('"returned_chars":1'));
  assert(page.includes('"truncated":false'));
  assert.equal(f.calls.filter(call => call.url.endsWith('/files')).length, 1, 'Paging reuses digest-matched extracted text');
  checks++;
  await assert.rejects(f.run({file_path: '/stored/hash', start_char: 20000}), /beyond/); checks++;
  f = fixture();
  await assert.rejects(f.run({file_path: '/stored/hash', max_chars: 16001}), /max_chars/);
  assert.equal(f.calls.length, 0); checks++;
  f = fixture();
  await assert.rejects(f.run({file_path: '', extra: true}), /file_path/);
  assert.equal(f.calls.length, 0); checks++;
  f = fixture();
  const aborted = AbortSignal.abort();
  await assert.rejects(f.definition.execute({file_path: '/stored/hash'}, {signal: aborted}), {name: 'AbortError'});
  assert.equal(f.calls.length, 0); checks++;
  console.log(JSON.stringify({checks, status: 'PASS', scope: 'PDF sandbox, uploaded hash paths, capabilities, metadata, limits, errors and cancellation; no live uploads'}));
}
main().catch(error => {console.error(error); process.exitCode = 1;}).finally(() => {global.fetch = originalFetch;});
