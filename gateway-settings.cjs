'use strict';
const {randomUUID} = require('node:crypto');
const {resolveConnection, connectionFromRecord, CONNECTION_RECORD} = require('./gateway-credentials.cjs');
function validKey(key) {
  return typeof key === 'string' && key.length >= 32 && key.length <= 4096 && !/[^\x21-\x7e]/.test(key);
}
function normalizeHost(value) {
  const {normalizeBaseUrl, DEFAULT_BASE_URL} = require('./gateway-url.cjs');
  if (typeof value !== 'string' || value.length > 2048) throw Error('invalidAddress');
  const input = value.trim();
  if (!input) return DEFAULT_BASE_URL;
  try {
    if (/^[a-z][a-z\d+.-]*:\/\//i.test(input)) return normalizeBaseUrl(input);
    // A bare host uses the gateway's default port. Full URLs keep their ports.
    const url = new URL('http://' + input);
    const authority = input.split(/[/?#]/, 1)[0];
    if (!url.port && !/:\d+$/.test(authority)) url.port = '8000';
    return normalizeBaseUrl(url.toString());
  } catch { throw Error('invalidAddress'); }
}
class GatewaySettings {
  constructor(host) { this.host = host; }
  async get() {
    // Same resolver as every outbound request; no file or UI-only credential fallback.
    const value = await resolveConnection(this.host.ctx.credentials);
    return {...value, keyConfigured:Boolean(value.apiKey)};
  }
  async set(payload) {
    if (!payload || Object.keys(payload).some(k => !['address','apiKey','revision'].includes(k)) ||
        typeof payload.apiKey !== 'string' || typeof payload.revision !== 'string') throw Error('invalidSettings');
    const baseUrl = normalizeHost(payload.address);
    const credentials = this.host.ctx.credentials;
    // Resolve the legacy DSH reference before entering the provider's exclusive write.
    const inherited = await resolveConnection(credentials);
    await credentials.modifyRecord(CONNECTION_RECORD, record => {
      if (record === undefined && inherited.revision !== 'inherited') throw Error('settingsChanged');
      const current = connectionFromRecord(record) ?? inherited;
      if (current.revision !== payload.revision) throw Error('settingsChanged');
      const key = payload.apiKey.trim() || current.apiKey;
      if (!key) throw Error('keyRequired');
      if (!validKey(key)) throw Error('invalidKey');
      return {kind:'grant', payload:{baseUrl, apiKey:key, revision:randomUUID()}};
    });
    this.host.capabilityCache = null;
    return this.get();
  }
  install() {
    for (const action of ['get','set']) {
      const endpoint = 'shanghaitech.gateway.' + action;
      this.host.ctx.effect(() => this.host.ctx.connection.fetch.register({
        path:'/api/' + endpoint, methods:['POST'], requestBody:'buffered',
        fetch:async request => {
          let envelope;
          try {
            const body = await request.text();
            if (body.length > 8192) throw Error('invalidSettings');
            envelope = JSON.parse(body);
            if (envelope.type !== 'client-request' || typeof envelope.rpcId !== 'string' || envelope.method !== endpoint ||
                !envelope.payload || Array.isArray(envelope.payload) || typeof envelope.payload !== 'object') throw Error('invalidSettings');
            const value = await this[action](envelope.payload);
            return Response.json({type:'server-response', rpcId:envelope.rpcId, result:{ok:true,value}}, {headers:{'Cache-Control':'no-store'}});
          } catch (error) {
            const known = ['invalidAddress','invalidSettings','invalidKey','keyRequired','settingsChanged'];
            const code = known.includes(error.message) ? error.message : 'settingsUnavailable';
            return Response.json({type:'server-response', rpcId:envelope?.rpcId ?? 'invalid-request', result:{ok:false,error:{code,message:code,details:{}}}});
          }
        },
      }), 'ShanghaiTech: gateway ' + action);
    }
  }
}
module.exports = {GatewaySettings, normalizeHost};
