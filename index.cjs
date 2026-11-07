exports.name = 'dsh-shanghaitech-genai';
exports.inject = ['llm', 'credentials', 'sessions', 'sessionQuery', 'sessionController', 'connection', 'attachments', 'fs', 'agentDefaultModel', 'agents', 'workspaceRegistry', 'sessionPersistence'];
exports.apply = async function (ctx) {
  const llm = await import('@deepseek-ai/dsh-llm');
  const session = await import('@deepseek-ai/dsh-session');
  const { OptionsHost } = require('./host.cjs');
  const { createAdapter } = require('./adapter.cjs');
  const { version } = require('@deepseek-ai/dsh-session/package.json');
  const host = new OptionsHost(ctx, session.appendPluginRecord, llm.attributionHeaders);
  require('./attachment-routing.cjs').installAttachmentRouting(ctx, options =>
    llm.isAgentLoopRequest(options) ? host.stepOptions(options) : undefined);
  ctx.llm.registerAdapter(['shanghaitech-genai'], createAdapter(llm, host, ctx));
  host.install(version);
  new (require('./gateway-settings.cjs').GatewaySettings)(host).install();
};
