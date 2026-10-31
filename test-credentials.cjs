'use strict';
const assert=require('node:assert/strict');
const {gatewayApiKey,CREDENTIAL}=require('./gateway-credentials.cjs');
async function main(){
  const calls=[];
  const credentials=values=>({resolve:async name=>{calls.push(name);return values[name];}});
  assert.equal(await gatewayApiKey(credentials({[CREDENTIAL]:{value:'synthetic-new'}})), 'synthetic-new');
  assert.deepEqual(calls.splice(0),[CREDENTIAL]);
  for(const value of ['', 'synthetic\nsecret', undefined]){
    await assert.rejects(gatewayApiKey(credentials({[CREDENTIAL]:{value}})), error=>error.code==='shanghaitech/credential-required'&&!error.message.includes('synthetic'));
    assert.deepEqual(calls.splice(0),[CREDENTIAL]);
  }
  await assert.rejects(gatewayApiKey(credentials({})), /SHANGHAITECH_GENAI_API_KEY/);
  await assert.rejects(gatewayApiKey({resolve:async()=>{throw Error('store unavailable');}}), /store unavailable/);
  console.log('PASS: credential reference, invalid values rejected and store errors preserved.');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
