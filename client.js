// Host-owned options, rendered through official list slots. No credential enters the browser.
window.__ModuleLoader__.load({
  id: 'dsh-shanghaitech-genai',
  factory(require) {
    const React = require('react');
    const {createSnapshotStore} = require('@deepseek-ai/dsh-client-store');
    const h = React.createElement;
    const NS = 'shanghaitech-options';
    const css = `.shanghaitech-options{display:inline-flex;align-items:center;gap:4px;flex-wrap:wrap}.shanghaitech-options button{font:inherit;font-size:12px;padding:3px 7px;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer}.shanghaitech-options button[aria-checked=true]{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}.shanghaitech-options button:disabled{opacity:.5;cursor:default}.shanghaitech-options button:focus-visible{outline:2px solid var(--dsw-focus-ring-color)}.shanghaitech-options [role=alert]{font-size:12px;color:var(--dsw-alias-state-error-primary)}`;

    function Options(props) {
      const state = props.useOptions(value => value);
      const picker = React.useRef(null);
      const [uploadError,setUploadError] = React.useState('');
      if (!state.visible) return null;
      const model = state.value?.capabilities.models.find(row => row.id === state.model);
      const disabled = state.status !== 'ready' || state.modelPending;
      function toggle(option) {
        const label = props.t(option);
        return h('button', {type:'button', role:'switch', 'aria-label':label,
          'aria-checked':Boolean(state.value?.[option]), disabled,
          title:props.t(option + 'Help'), onClick:() => {void props.selectOptions(option, !state.value?.[option]);}},
          label);
      }
      return h('span', {className:'shanghaitech-options', 'aria-label':props.t('label')},
        h('style', null, css),
        model?.search.supported && toggle('search'),
        model?.thinking.supported && toggle('thinking'),
        props.inputActions && h('button',{type:'button',disabled,title:props.t('attachmentsHelp'),onClick:()=>picker.current?.click()},props.t('attachments')),
        props.inputActions && h('input',{type:'file',hidden:true,multiple:true,accept:'.png,.jpg,.jpeg,.webp,.gif,.pdf,.txt,.csv,.docx',ref:picker,onChange:event=>{
          const files=Array.from(event.target.files??[]);event.target.value='';
          try{props.addWebsiteAttachments(files,props.inputActions);setUploadError('');}catch(error){setUploadError(error.message);}
        }}),
        uploadError && h('span',{role:'alert'},props.t(uploadError)),
        state.status === 'loading' && h('span', {role:'status'}, props.t('loading')),
        state.error && h('span', {role:'alert'}, props.t('saveFailed') + ' (' + state.error + ')'),
        state.error && h('button', {type:'button', onClick:() => {void props.reload();}}, props.t('retry')));
    }

    // One controller per session, shared by the composer and hero slots.
    function controller(ctx, sessionId) {
      const directory = ctx.modelDirectories.directoryFor(sessionId);
      const store = createSnapshotStore({visible:false, model:null, value:null, status:'idle', error:false, modelPending:false});
      let generation = 0, disposed = false, active, identity;
      function publish(value) { if (!disposed) store.set({...store.getSnapshot(), ...value}); }
      async function rpc(endpoint, payload, signal) {
        const result = await ctx.connection.rpc.call('/api', endpoint, payload, signal);
        if (!result?.ok) throw Error(result?.error?.code || 'OPTIONS_UNAVAILABLE');
        const value = result.value;
        if (value.provider !== 'shanghaitech-genai' || value.model !== payload.model || !Array.isArray(value.capabilities?.models) ||
            typeof value.search !== 'boolean' || typeof value.thinking !== 'boolean' || !Number.isSafeInteger(value.revision)) throw Error('OPTIONS_INVALID');
        return value;
      }
      async function reload() {
        const current = directory.store.getSnapshot().current;
        if (disposed || current?.provider !== 'shanghaitech-genai' || ctx.sessions.subagentAddress(sessionId) !== undefined) return;
        const turn = ++generation;
        active?.abort(); active = new AbortController();
        publish({status:'loading',error:false,value:null,model:current.model});
        try {
          const value = await rpc('shanghaitech.options.get', {sessionId,model:current.model}, active.signal);
          if (turn === generation) publish({status:'ready',value,error:false});
        } catch (error) { if (turn === generation && !disposed) publish({status:'error',error:String(error.message || 'OPTIONS_UNAVAILABLE')}); }
      }
      function sync() {
        const state = directory.store.getSnapshot();
        const current = state.current;
        const visible = current?.provider === 'shanghaitech-genai' && ctx.sessions.subagentAddress(sessionId) === undefined;
        const nextIdentity = visible ? current.model : null;
        publish({visible, model:nextIdentity, modelPending:state.pending !== null || state.status !== 'ready'});
        if (identity !== nextIdentity) {
          identity = nextIdentity; ++generation; active?.abort();
          publish({value:null,error:false,status:'idle'});
          if (visible) void reload();
        }
      }
      async function selectOptions(option, enabled) {
        const state = store.getSnapshot();
        const current = directory.store.getSnapshot();
        const model = state.value?.capabilities.models.find(row => row.id === state.model);
        if (!['search','thinking'].includes(option) || typeof enabled !== 'boolean' || !model?.[option]?.supported ||
            !state.visible || state.status !== 'ready' || state.modelPending || current.current?.model !== state.model ||
            current.current?.provider !== 'shanghaitech-genai') return;
        const turn = ++generation;
        active?.abort(); active = new AbortController();
        publish({status:'saving',error:false});
        try {
          const value = await rpc('shanghaitech.options.set', {sessionId, model:state.model,
            search:state.value.search, thinking:state.value.thinking, [option]:enabled, expectedRevision:state.value.revision}, active.signal);
          if (turn === generation) publish({status:'ready',value,error:false});
        } catch (error) { if (turn === generation && !disposed) publish({status:'error',error:String(error.message || 'OPTIONS_UNAVAILABLE')}); }
      }
      const unsubscribe = directory.store.subscribe(sync);
      const reset = ctx.on('connection/reset', () => { identity = undefined; sync(); });
      sync();
      return {hooks:{options:store}, selectOptions, reload, dispose() {disposed=true;++generation;active?.abort();unsubscribe();reset();}};
    }

    return {
      inject:['slots','modelDirectories','sessions','locale','connection','conversation'],
      apply(ctx) {
        const controllers = new Map();
        ctx.effect(() => () => {for (const value of controllers.values()) value.dispose();controllers.clear();}, 'ShanghaiTech: options teardown');
        function face(sessionId) {
          let value = controllers.get(sessionId);
          if (!value) {
            value = controller(ctx, sessionId); controllers.set(sessionId,value);
            const scope = ctx.sessions.scope(sessionId);
            scope.effect(() => () => {value.dispose();controllers.delete(sessionId);}, 'ShanghaiTech: session options');
          }
          return {hooks:value.hooks,selectOptions:value.selectOptions,reload:value.reload,
            addWebsiteAttachments(files,actions) {
              const state=value.hooks.options.getSnapshot();
              if(!state.visible||state.modelPending||state.status!=='ready')throw Error('attachmentsNotReady');
              for(const file of files){
                const ext=file.name.split('.').pop().toLowerCase();
                const image=['png','jpg','jpeg','webp','gif'].includes(ext);
                if(!image&&!['pdf','txt','csv','docx'].includes(ext))throw Error('attachmentsFormat');
                if(!file.size||file.size>=(image?20:10)*1024*1024)throw Error('attachmentsSize');
              }
              // Exact-byte file receipts preserve GIFs and avoid DSH's normal
              // image normalization. Storage, cancellation and access stay DSH-owned.
              const drafts=ctx.conversation.createDrafts(sessionId,files.map(file=>new File([file],file.name,{type:'application/octet-stream'})));
              if(!actions.addAttachments(drafts.map(draft=>draft.id))){ctx.conversation.releaseDraftAttachments(drafts);throw Error('attachmentsLocked');}
            }};
        }
        ctx.effect(() => ctx.locale.register(NS, {
          en:{label:'ShanghaiTech GenAI options',search:'Search',thinking:'Thinking',attachments:'Attachments',loading:'Loading options…',retry:'Reload',saveFailed:'Options unavailable or not saved. Reload to retry.',searchHelp:'Use the original website’s web search for the next request.',thinkingHelp:'Use the original website’s deep thinking for the next request.',attachmentsHelp:'Use the original website’s image upload and document parsing. Original files are uploaded when you send. Images <20 MiB; documents <10 MiB.',attachmentsNotReady:'Wait for the current model to be ready before adding attachments.',attachmentsFormat:'Supported images: PNG, JPEG, WebP, GIF. Verified documents: PDF, TXT, CSV, DOCX.',attachmentsSize:'Select nonempty images below 20 MiB or documents below 10 MiB.',attachmentsLocked:'The input is locked. Try adding attachments later.'},
          zh:{label:'ShanghaiTech GenAI 选项',search:'联网搜索',thinking:'深度思考',attachments:'网页附件',loading:'载入选项…',retry:'重新载入',saveFailed:'选项不可用或未保存，请重新载入。',searchHelp:'直接调用原网页的联网搜索功能，用于下一次请求。',thinkingHelp:'直接调用原网页的深度思考功能，用于下一次请求。',attachmentsHelp:'直接调用原网页的图片上传与文档解析功能，发送时上传原文件。图片 <20 MiB；文档 <10 MiB。',attachmentsNotReady:'请等待当前模型就绪后添加附件。',attachmentsFormat:'支持图片：PNG、JPEG、WebP、GIF；已验证文档：PDF、TXT、CSV、DOCX。',attachmentsSize:'请选择非空文件，图片须小于 20 MiB，文档须小于 10 MiB。',attachmentsLocked:'当前输入已锁定，请稍后再添加附件。'},
        }), 'ShanghaiTech: option labels');
        for (const name of ['conversation.input.left','conversation.hero.options']) ctx.slots.inject(name, () => ctx.slots.register({name,id:'shanghaitech-options',order:20,locale:NS,inject:face}, Options));
      },
    };
  },
});
