exports.name = 'dsh-shanghaitech-genai';
exports.inject = ['llm', 'credentials', 'sessions', 'sessionQuery', 'sessionController', 'connection', 'attachments', 'fs', 'agentDefaultModel'];
exports.apply = async function (ctx) {
  const llm = await import('@deepseek-ai/dsh-llm');
  const session = await import('@deepseek-ai/dsh-session');
  const { OptionsHost } = require('./host.cjs');
  const { createAdapter } = require('./adapter.cjs');
  require('./attachment-routing.cjs').installAttachmentRouting(ctx);
  const host = new OptionsHost(ctx, session.appendPluginRecord, llm.attributionHeaders);
  ctx.llm.registerAdapter(['shanghaitech-genai'], createAdapter(llm, host, ctx));
  host.install();
};
