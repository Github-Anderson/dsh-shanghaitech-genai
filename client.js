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
      const [confirmDelete,setConfirmDelete] = React.useState(false);
      const [deleteWebsite,setDeleteWebsite] = React.useState(true);
      if (!state.visible) return null;
      const model = state.value?.capabilities.models.find(row => row.id === state.model);
      const disabled = state.status !== 'ready' || state.modelPending || state.deleting || state.deleted;
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
        props.inputActions && h('input',{type:'file',hidden:true,multiple:true,accept:'.png,.jpg,.jpeg,.webp,.gif,.pdf,.txt,.csv,.docx,.xls,.xlsx,.ppt,.pptx,.html,.json',ref:picker,onChange:event=>{
          const files=Array.from(event.target.files??[]);event.target.value='';
          try{props.addWebsiteAttachments(files,props.inputActions);setUploadError('');}catch(error){setUploadError(error.message);}
        }}),
        h('button',{type:'button',disabled:state.modelPending||state.deleting||state.deleted,title:props.t('deleteHelp'),onClick:()=>setConfirmDelete(true)},props.t('deleteSession')),
        confirmDelete && h('span',{role:'dialog','aria-label':props.t('deleteSession')},
          h('span',null,props.t('deleteConfirm')),
          h('label',null,h('input',{type:'checkbox',checked:deleteWebsite,disabled:state.deleting,onChange:e=>setDeleteWebsite(e.target.checked)}),props.t('deleteWebsite')),
          h('button',{type:'button',disabled:state.deleting,onClick:()=>{void props.deleteSession(deleteWebsite).then(ok=>{if(ok)setConfirmDelete(false);});}},props.t(state.deleting?'deleting':'deleteConfirmButton')),
          h('button',{type:'button',disabled:state.deleting,onClick:()=>setConfirmDelete(false)},props.t('deleteCancel'))),
        state.deleteError && h('span',{role:'alert'},props.t(state.deleteWebsiteDone?'localDeleteFailed':'deleteFailed')+' ('+state.deleteError+')'),
        state.deleted && h('span',{role:'status'},props.t(state.deleteWarning?'deletedIndexWarning':'deleted')),
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
      async function deleteSession(deleteWebsite) {
        const state=store.getSnapshot();
        if(disposed||state.deleting||state.deleted||!state.visible||state.modelPending||typeof deleteWebsite!=='boolean')return false;
        active?.abort();++generation;
        publish({deleting:true,deleteError:false,deleteWebsiteDone:false,deleteWarning:false});
        try {
          const result=await ctx.connection.rpc.call('/api','shanghaitech.session.delete',{sessionId,deleteWebsite},new AbortController().signal);
          if(!result?.ok||result.value?.deleted!==true||result.value.sessionId!==sessionId){
            const error=Error(result?.error?.code||'DELETE_FAILED');
            error.websiteDeleted=result?.error?.details?.website_deleted===true;
            throw error;
          }
          publish({deleted:true,status:'deleted',value:null,deleteWarning:result.value.warnings?.includes('search_index_refresh_failed')===true});
          return true;
        }catch(error){publish({deleteError:String(error.message||'DELETE_FAILED'),deleteWebsiteDone:error.websiteDeleted===true});return false;}
        finally{publish({deleting:false});}
      }
      const unsubscribe = directory.store.subscribe(sync);
      const reset = ctx.on('connection/reset', () => { identity = undefined; sync(); });
      sync();
      return {hooks:{options:store}, selectOptions, reload, deleteSession, dispose() {disposed=true;++generation;active?.abort();unsubscribe();reset();}};
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
          return {hooks:value.hooks,selectOptions:value.selectOptions,reload:value.reload,deleteSession:value.deleteSession,
            addWebsiteAttachments(files,actions) {
              const state=value.hooks.options.getSnapshot();
              if(!state.visible||state.modelPending||state.status!=='ready')throw Error('attachmentsNotReady');
              for(const file of files){
                const ext=file.name.split('.').pop().toLowerCase();
                const image=['png','jpg','jpeg','webp','gif'].includes(ext);
                if(!image&&!['pdf','txt','csv','docx','xls','xlsx','ppt','pptx','html','json'].includes(ext))throw Error('attachmentsFormat');
                if(!file.size||file.size>=(image?20:10)*1024*1024)throw Error('attachmentsSize');
              }
              // Exact-byte file receipts preserve GIFs and avoid DSH's normal
              // image normalization. Storage, cancellation and access stay DSH-owned.
              const drafts=ctx.conversation.createDrafts(sessionId,files.map(file=>new File([file],file.name,{type:'application/octet-stream'})));
              if(!actions.addAttachments(drafts.map(draft=>draft.id))){ctx.conversation.releaseDraftAttachments(drafts);throw Error('attachmentsLocked');}
            }};
        }
        ctx.effect(() => ctx.locale.register(NS, {
          en:{localDeleteFailed:'Website history was deleted, but local cleanup did not finish. Reload to inspect the local session.',deletedIndexWarning:'Session deleted. Search index refresh is pending; do not delete the session again.',deleteSession:'Delete session',deleteHelp:'Permanently delete this local DSH session and its subagents.',deleteConfirm:'Permanently delete this local session and its subagents? This cannot be undone.',deleteWebsite:'Also delete website history',deleteConfirmButton:'Permanently delete',deleteCancel:'Cancel',deleting:'Deleting…',deleted:'Session deleted.',deleteFailed:'Deletion did not complete. Reload to inspect the result. Website failures retain the local session; uncheck website history only if local-only deletion is intended.',label:'ShanghaiTech GenAI options',search:'Search',thinking:'Thinking',attachments:'Attachments',loading:'Loading options…',retry:'Reload',saveFailed:'Options unavailable or not saved. Reload to retry.',searchHelp:'Use the original website’s web search for the next request.',thinkingHelp:'Use the original website’s deep thinking for the next request.',attachmentsHelp:'Use the original website’s image upload and document parsing. Original files are uploaded when you send. Images <20 MiB; documents <10 MiB.',attachmentsNotReady:'Wait for the current model to be ready before adding attachments.',attachmentsFormat:'Supported images: PNG, JPEG, WebP, GIF. Verified documents: PDF, TXT, CSV, DOCX, XLS, XLSX, PPT, PPTX, HTML, JSON.',attachmentsSize:'Select nonempty images below 20 MiB or documents below 10 MiB.',attachmentsLocked:'The input is locked. Try adding attachments later.'},
          zh:{localDeleteFailed:'网站历史已删除，但本地清理未完成，请重新载入核对本地会话。',deletedIndexWarning:'会话已删除，搜索索引暂未刷新，无需重复删除。',deleteSession:'删除会话',deleteHelp:'永久删除当前 DSH 本地会话及其子代理会话。',deleteConfirm:'永久删除本地会话及其子代理？删除后不可恢复。',deleteWebsite:'同时删除网站历史',deleteConfirmButton:'永久删除',deleteCancel:'取消',deleting:'正在删除…',deleted:'会话已删除。',deleteFailed:'删除未完成，请重新载入核对。网站删除失败时保留本地会话；仅需删除本地时可取消勾选网站历史。',label:'ShanghaiTech GenAI 选项',search:'联网搜索',thinking:'深度思考',attachments:'网页附件',loading:'载入选项…',retry:'重新载入',saveFailed:'选项不可用或未保存，请重新载入。',searchHelp:'直接调用原网页的联网搜索功能，用于下一次请求。',thinkingHelp:'直接调用原网页的深度思考功能，用于下一次请求。',attachmentsHelp:'直接调用原网页的图片上传与文档解析功能，发送时上传原文件。图片 <20 MiB；文档 <10 MiB。',attachmentsNotReady:'请等待当前模型就绪后添加附件。',attachmentsFormat:'支持图片：PNG、JPEG、WebP、GIF；已验证文档：PDF、TXT、CSV、DOCX、XLS、XLSX、PPT、PPTX、HTML、JSON。',attachmentsSize:'请选择非空文件，图片须小于 20 MiB，文档须小于 10 MiB。',attachmentsLocked:'当前输入已锁定，请稍后再添加附件。'},
        }), 'ShanghaiTech: option labels');
        for (const name of ['conversation.input.left','conversation.hero.options']) ctx.slots.inject(name, () => ctx.slots.register({name,id:'shanghaitech-options',order:20,locale:NS,inject:face}, Options));
      },
    };
  },
});
