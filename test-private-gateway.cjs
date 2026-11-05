'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {gatewayConnection,DEFAULT_BASE_URL}=require('./gateway-url.cjs');
const {gatewayApiKey}=require('./gateway-credentials.cjs');
async function main(){
 const root=process.env.DSH_HOME;assert(root?.includes('genai-tests-'));
 const privateDir=path.join(root,'private');fs.mkdirSync(privateDir);
 fs.writeFileSync(path.join(root,'shanghaitech-genai.json'),JSON.stringify({private_dir:privateDir}));
 for(const name of ['dsh-ui-connection.json','shanghaitech-genai.connection.json','dsh-gateway.json','gateway.key'])fs.writeFileSync(path.join(privateDir,name),'invalid local data');
 process.env.SHANGHAITECH_GENAI_BASE_URL='https://unused.invalid';
 const key='synthetic-native-key-'.repeat(3),credentials={resolve:async()=>({value:key})};
 const current=await gatewayConnection(credentials);
 assert.equal(current.baseUrl,DEFAULT_BASE_URL);assert.equal(current.apiKey,key);
 assert.equal(await gatewayApiKey(credentials),key);
 await assert.rejects(gatewayApiKey({resolve:async()=>undefined}),e=>e.code==='shanghaitech/credential-required');
 assert.equal(fs.readFileSync(path.join(privateDir,'dsh-gateway.json'),'utf8'),'invalid local data');
 console.log('PASS: local files and launcher address ignored; only DSH credentials determine the key.');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
