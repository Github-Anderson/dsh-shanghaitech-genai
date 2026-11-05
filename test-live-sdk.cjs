'use strict';
// Opt-in: installed SDK + installed development plugin + a real local gateway.
// Tool observations are synthetic; no model-generated command is executed.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');
const {createRequire} = require('node:module');

let credentialRoot;
async function main() {
  assert.equal(process.env.GENAI_LIVE_TEST, '1', 'Set GENAI_LIVE_TEST=1 explicitly');
  assert(process.env.DSH_HOME && process.env.DSH_TEST_SDK_ROOT && process.env.DSH_TEST_PLUGIN_ROOT,
    'Specify the isolated DSH home, SDK root and installed development plugin');
  const plugin = path.resolve(process.env.DSH_TEST_PLUGIN_ROOT);
  assert(plugin.startsWith(path.resolve(process.env.DSH_HOME) + path.sep), 'Use the plugin installed in the test DSH home');
  const {gatewayBaseUrl, gatewayConnection} = require(path.join(plugin, 'gateway-url.cjs'));
  const {gatewayApiKey} = require(path.join(plugin, 'gateway-credentials.cjs'));
  const {conversationId} = require(path.join(plugin, 'gateway-contract.cjs'));
  const {createAdapter} = require(path.join(plugin, 'adapter.cjs'));
  const sdk = createRequire(path.join(process.env.DSH_TEST_SDK_ROOT, 'package.json'));
  credentialRoot = new (sdk('@deepseek-ai/cordis').Context)();
  await credentialRoot.plugin(sdk('@deepseek-ai/dsh-credentials-local').LocalCredentialProvider, {watch:false,dshHome:process.env.DSH_HOME,path:path.join(process.env.DSH_HOME,'.credentials.yaml')}).await();
  const credentials = credentialRoot.credentials;
  const connection = await gatewayConnection(credentials);
  const base = gatewayBaseUrl(connection);
  assert.equal(base, 'http://127.0.0.1:8000/v1', 'This probe only targets the local development gateway');
  const model = process.env.GENAI_TEST_MODEL || 'qwen-instruct';
  assert(['deepseek-pro', 'Kimi-k3', 'qwen-instruct', 'chatglm'].includes(model), 'Only authorized non-GPT models');
  const llm = sdk('@deepseek-ai/dsh-llm');
  const key = await gatewayApiKey(credentials, connection);
  const headers = {'Authorization':'Bearer ' + key};
  const sessionId = 'development-sdk-' + crypto.randomUUID();
  const id = conversationId(sessionId, 'chat');
  const host = {ctx:{credentials}, snapshots:new Map(), snapshot:async()=>({search:false, thinking:false}),
    headers:async()=>headers, fetch:global.fetch};
  const adapter = createAdapter(llm, host, {credentials});
  const user = text => llm.createUserMessage({source:{kind:'user'}, content:[{type:'text', text}]});
  async function assemble(options) {
    const result = new llm.BlockAssembler();
    for await (const chunk of adapter.stream(options)) result.push(chunk);
    return result;
  }
  const options = {provider:'shanghaitech-genai', model, sessionId, maxTokens:512,
    messages:[user('Reply exactly LOCAL_PLUGIN_OK.')]};
  try {
    const text = await assemble(options);
    assert.equal(text.finish.kind, 'stop');
    assert(text.blocks().some(b=>b.type==='text' && b.text.includes('LOCAL_PLUGIN_OK')));
    console.log(JSON.stringify({case:'installed_plugin_stream', model, status:'PASS'}));
    options.messages.push(llm.createAssistantMessage({source:{provider:'shanghaitech-genai', model}, content:text.blocks()}));
    options.tools = [{name:'bash', description:'Request a command from the test client.', parameters:{type:'object',properties:{command:{type:'string'},description:{type:'string'}},required:['command','description'],additionalProperties:false}}];
    options.messages.push(user('协议测试：请调用 bash 工具请求执行 printf TOOL_LOOP_OK。只生成工具调用；测试客户端负责模拟结果。'));
    const tools = await assemble(options);
    assert.equal(tools.finish.kind, 'tool-calls');
    const calls = tools.blocks().filter(b=>b.type==='tool-call');
    assert.equal(calls.length,1); assert.equal(calls[0].name,'bash');
    assert(JSON.parse(calls[0].arguments).command.includes('TOOL_LOOP_OK'));
    options.messages.push(llm.createAssistantMessage({source:{provider:'shanghaitech-genai', model}, content:tools.blocks()}),
      llm.createToolResultMessage({callId:calls[0].id,content:[{type:'text',text:'Synthetic observation: TOOL_LOOP_OK. Command was not executed.'}],isError:false}),
      user('测试结束。只回复 TOOL_LOOP_OK，不再调用工具。'));
    const final = await assemble(options);
    assert.equal(final.finish.kind,'stop');
    assert(final.blocks().some(b=>b.type==='text' && b.text.includes('TOOL_LOOP_OK')));
    console.log(JSON.stringify({case:'installed_plugin_tool_roundtrip',model,status:'PASS',commands_executed:0}));
  } finally {
    const response = await fetch(base + '/conversations/' + id, {method:'DELETE',headers,signal:AbortSignal.timeout(30000)});
    assert(response.ok, 'Test conversation cleanup failed');
    assert.equal((await response.json()).deleted,true);
    console.log(JSON.stringify({case:'cleanup',status:'PASS'}));
  }
}
main().finally(async()=>{await credentialRoot?.fiber.dispose();}).catch(error=>{
  console.error(JSON.stringify({status:'FAIL',error_type:error.name,error_code:error.code || 'assertion_or_runtime_failure'}));
  process.exitCode=1;
});
