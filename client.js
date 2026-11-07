// Host-owned options and gateway settings, rendered through official slots. Gateway values come from the same DSH credential resolver as requests.
window.__ModuleLoader__.load({
  id: 'dsh-shanghaitech-genai',
  factory(require) {
    const React = require('react');
    const {createSnapshotStore} = require('@deepseek-ai/dsh-client-store');
    const {Button, Modal, IconPaperclipOutlineRegular, IconTrashOutlineRegular} = require('@deepseek-ai/dsh-client-ui-primitives');
    const h = React.createElement;
    const NS = 'shanghaitech-options';
    const css = `.shanghaitech-options{display:inline-flex;align-items:center;gap:4px;flex-wrap:wrap}.shanghaitech-options button{font:inherit;font-size:12px;padding:3px 7px;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer}.shanghaitech-options button[aria-checked=true]{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}.shanghaitech-options button:disabled{opacity:.5;cursor:default}.shanghaitech-options button:focus-visible{outline:2px solid var(--dsw-focus-ring-color)}.shanghaitech-options [role=alert]{font-size:12px;color:var(--dsw-alias-state-error-primary)}`;

    function Options(props) {
      const state = props.useOptions(value => value);
      const picker = React.useRef(null);
      const [uploadError,setUploadError] = React.useState('');
      React.useEffect(() => props.enterView?.(() => picker.current?.click()), [props.enterView]);
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
        props.inputActions && h('input',{type:'file',hidden:true,multiple:true,accept:'.png,.jpg,.jpeg,.webp,.gif,.pdf,.txt,.csv,.docx,.xls,.xlsx,.ppt,.pptx,.html,.htm,.md,.markdown,.log,.json',ref:picker,onChange:event=>{
          const files=Array.from(event.target.files??[]);event.target.value='';
          try{props.addWebsiteAttachments(files,props.inputActions);setUploadError('');}catch(error){setUploadError(error.message);}
        }}),
        uploadError && h('span',{role:'alert'},props.t(uploadError)),
        state.status === 'loading' && h('span', {role:'status'}, props.t('loading')),
        state.error && h('span', {role:'alert'}, props.t('saveFailed') + ' (' + state.error + ')'),
        state.error && h('button', {type:'button', onClick:() => {void props.reload();}}, props.t('retry')));
    }


    function DeleteDialog({useDeletion, dismiss, setDeleteWebsite, confirm, t}) {
      const request = useDeletion(value => value);
      if (!request) return null;
      const {title, deleteWebsite, deleting, error} = request;
      return h(Modal, {
        open: true,
        onClose: dismiss,
        closeLabel: t('deleteCancel'),
        title: t('deleteSession'),
        description: t('deleteConfirm', {title}),
        footer: h(React.Fragment, null,
          h(Button, {variant:'outline', disabled:deleting, onClick:dismiss, 'data-modal-autofocus':true}, t('deleteCancel')),
          h(Button, {variant:'outline', style:{color:'var(--dsw-alias-state-error-primary)'}, disabled:deleting, onClick:confirm}, t(deleting ? 'deleting' : 'deleteConfirmButton'))),
      },
      h('label', {style:{display:'flex', alignItems:'center', gap:8}},
        h('input', {type:'checkbox', checked:deleteWebsite, disabled:deleting, onChange:event=>setDeleteWebsite(event.target.checked)}),
        t('deleteWebsite')),
      error && h('p', {role:'alert'}, t(error.label) + ' (' + error.code + ')'));
    }

    function installSessionDeletion(ctx) {
      const deletion = createSnapshotStore(null);
      const t = ctx.locale.bind(NS);
      const menus = ctx.contextMenus;

      function dismiss() {
        if (!deletion.getSnapshot()?.deleting) deletion.set(null);
      }

      async function confirm() {
        const request = deletion.getSnapshot();
        if (!request || request.deleting) return;
        const {sessionId, deleteWebsite} = request;
        deletion.set({...request, deleting:true, error:null});
        try {
          const result = await ctx.connection.rpc.call('/api', 'shanghaitech.session.delete', {sessionId, deleteWebsite}, new AbortController().signal);
          if (!result?.ok || result.value?.deleted !== true || result.value.sessionId !== sessionId) {
            deletion.set({...request, error:{
              label:result?.error?.details?.website_deleted === true ? 'localDeleteFailed' : 'deleteFailed',
              code:result?.error?.code || 'DELETE_FAILED',
            }});
            return;
          }
          deletion.set(null);
          menus.notify(t(result.value.warnings?.includes('search_index_refresh_failed') ? 'deletedIndexWarning' : 'deleted'), true);
        } catch {
          if (deletion.getSnapshot()) deletion.set({...request, error:{label:'deleteFailed', code:'DELETE_FAILED'}});
        }
      }

      ctx.slots.inject('shell.overlay', () => ctx.slots.register({
        name:'shell.overlay', id:'shanghaitech-delete-dialog', locale:NS,
        inject:() => ({
          hooks:{deletion}, dismiss, confirm,
          setDeleteWebsite(deleteWebsite) {
            const request = deletion.getSnapshot();
            if (request && !request.deleting) deletion.set({...request, deleteWebsite});
          },
        }),
      }, DeleteDialog));
      ctx.slots.inject('contextMenu.icon', () => ctx.slots.register({
        name:'contextMenu.icon', key:'shanghaitech-delete', inline:true,
      }, () => h(IconTrashOutlineRegular, {size:16})));
      ctx.effect(() => menus.register({
        id:'shanghaitech-delete', target:'session', order:700,
        observe:() => [ctx.locale],
        async resolve({sessionId, displayTitle}, signal) {
          const result = await ctx.connection.rpc.call('/api', 'shanghaitech.session.deleteEligibility', {sessionId}, signal);
          if (!result?.ok || result.value?.eligible !== true) return [];
          return [{
            id:'delete', label:t('deleteSession'), icon:{key:'shanghaitech-delete'}, separatorBefore:true, afterContent:true,
            run:() => {
              if (!deletion.getSnapshot()) {
                deletion.set({sessionId, title:displayTitle || sessionId, deleteWebsite:true, deleting:false, error:null});
              }
            },
          }];
        },
      }), 'ShanghaiTech: session menu');
    }

    function GatewaySettings(props) {
      const [saved, setSaved] = React.useState(null);
      const [address, setAddress] = React.useState('');
      const [apiKey, setApiKey] = React.useState('');
      const [showKey, setShowKey] = React.useState(false);
      const [busy, setBusy] = React.useState(true);
      const [error, setError] = React.useState('');
      const [success, setSuccess] = React.useState(false);
      const active = React.useRef(null);
      const keyId = React.useId(), addressId = React.useId();
      async function request(action, payload) {
        active.current?.abort();
        const controller = new AbortController(); active.current = controller;
        const result = await props.rpc(action, payload, controller.signal);
        controller.signal.throwIfAborted();
        if (!result?.ok) throw Error(result?.error?.code || 'settingsUnavailable');
        return result.value;
      }
      function accept(value) {
        setSaved(value); setAddress(value.baseUrl === 'http://127.0.0.1:8000/v1' ? '' : value.baseUrl); setApiKey(value.apiKey); setShowKey(false);
      }
      async function reload(activate=false) {
        setBusy(true); setError(''); setSuccess(false);
        try { accept(await request('get', {})); }
        catch(e) { if(e.name !== 'AbortError') setError(e.message); }
        finally { setBusy(false); }
      }
      React.useEffect(() => { void reload(); return () => active.current?.abort(); }, []);
      const dirty = saved && (apiKey !== saved.apiKey || address !== (saved.baseUrl === 'http://127.0.0.1:8000/v1' ? '' : saved.baseUrl));
      async function toggleKey() {
        if (showKey) { setShowKey(false); return; }
        // Refresh the active key before revealing; keep explicit unsaved edits as a draft.
        if (!dirty) {
          setBusy(true); setError('');
          try { accept(await request('get', {})); setShowKey(true); }
          catch(e) { if(e.name !== 'AbortError') setError(e.message); }
          finally { setBusy(false); }
        } else setShowKey(true);
      }
      async function save(event) {
        event.preventDefault(); if(busy || !saved) return;
        setBusy(true); setError(''); setSuccess(false);
        try { accept(await request('set', {address, apiKey, revision:saved.revision})); setSuccess(true); }
        catch(e) { if(e.name !== 'AbortError') setError(e.message); }
        finally { setBusy(false); }
      }
      return h('form', {className:'shanghaitech-gateway', onSubmit:save, 'aria-label':props.t('gatewayTitle')},
        h('style',null,`.shanghaitech-gateway{display:grid;gap:12px;max-width:560px;margin:20px 0;color:var(--dsw-alias-label-primary)}.shanghaitech-gateway h3{font-size:15px;margin:0}.shanghaitech-gateway label{display:grid;gap:6px;font-size:13px}.shanghaitech-gateway input{box-sizing:border-box;width:100%;min-width:0;font:inherit;padding:9px 11px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;color:inherit;background:transparent}.shanghaitech-gateway small{color:var(--dsw-alias-label-secondary);line-height:1.5}.shanghaitech-gateway button{font:inherit;padding:7px 14px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;color:inherit;background:var(--dsw-alias-interactive-bg-hover);cursor:pointer}.shanghaitech-gateway button:disabled{opacity:.5;cursor:default}.shanghaitech-gateway input:focus-visible,.shanghaitech-gateway button:focus-visible{outline:2px solid var(--dsw-focus-ring-color);outline-offset:2px}.shanghaitech-gateway [role=alert]{color:var(--dsw-alias-state-error-primary);font-size:13px}.shanghaitech-gateway-key{display:flex;gap:8px;align-items:center}.shanghaitech-gateway-key input{flex:1}.shanghaitech-gateway-key button{flex-shrink:0}.shanghaitech-gateway-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap;font-size:13px}`),
        h('h3',null,props.t('gatewayTitle')),
        h('label',{htmlFor:keyId},props.t('gatewayKey'),
          h('span',{className:'shanghaitech-gateway-key'},
            h('input',{id:keyId,type:showKey?'text':'password',value:apiKey,disabled:busy || !saved,autoComplete:'off',spellCheck:false,maxLength:4096,
              placeholder:props.t('gatewayKeyPlaceholder'),
              onChange:e=>{setApiKey(e.target.value);setSuccess(false);}}),
            h('button',{type:'button',disabled:busy || !saved,'aria-label':props.t(showKey?'gatewayHideKey':'gatewayShowKey'),
              'aria-pressed':showKey,'aria-controls':keyId,onClick:toggleKey},props.t(showKey?'gatewayHideKey':'gatewayShowKey'))),
          h('small',null,props.t(dirty?'gatewayUnsaved':'gatewayKeyConfigured'))),
        h('label',{htmlFor:addressId},props.t('gatewayAddress'),
          h('input',{id:addressId,type:'text',value:address,disabled:busy || !saved,autoComplete:'off',spellCheck:false,maxLength:2048,
            placeholder:'http://127.0.0.1:8000',onChange:e=>{setAddress(e.target.value);setSuccess(false);}}),
          h('small',null,props.t('gatewayAddressHelp'))),
        h('div',{className:'shanghaitech-gateway-actions'},
          h('button',{type:'submit',disabled:busy || !saved},props.t(busy?'gatewayWorking':'gatewaySave')),
          error && h('button',{type:'button',disabled:busy,onClick:reload},props.t('retry')),
          success && h('span',{role:'status'},props.t('gatewaySaved'))),
        error && h('span',{role:'alert'},props.t(['invalidAddress','invalidSettings','invalidKey','keyRequired','settingsChanged'].includes(error)?error:'settingsUnavailable')));
    }

    // Session options outlive each composer occurrence.
    function controller(ctx, sessionId) {
      const directory = ctx.modelDirectories.directoryFor(sessionId);
      const store = createSnapshotStore({visible:false, model:null, value:null, status:'idle', error:false, modelPending:false});
      let generation = 0, disposed = false, active, identity;
      let enteredBefore = false, viewActive = false;
      const attachmentPickers = new Set();
      function enterView(openPicker) {
        if (disposed) return;
        attachmentPickers.add(openPicker);
        if (!viewActive) {
          viewActive = true;
          if (enteredBefore) { clearWebsiteDrafts(); void reload(true); }
          enteredBefore = true;
        }
        return () => {
          attachmentPickers.delete(openPicker);
          queueMicrotask(() => { if (!attachmentPickers.size) viewActive = false; });
        };
      }
      const websiteDrafts = new Map();
      function clearWebsiteDrafts() {
        for (const [id, actions] of websiteDrafts) actions.removeAttachment?.(id);
        websiteDrafts.clear();
      }
      function publish(value) { if (!disposed) store.set({...store.getSnapshot(), ...value}); }
      async function rpc(endpoint, payload, signal) {
        const result = await ctx.connection.rpc.call('/api', endpoint, payload, signal);
        if (!result?.ok) throw Error(result?.error?.code || 'OPTIONS_UNAVAILABLE');
        const value = result.value;
        if (value.provider !== 'shanghaitech-genai' || value.model !== payload.model || !Array.isArray(value.capabilities?.models) ||
            typeof value.search !== 'boolean' || typeof value.thinking !== 'boolean' || !Number.isSafeInteger(value.revision)) throw Error('OPTIONS_INVALID');
        return value;
      }
      async function reload(activate=false) {
        const current = directory.store.getSnapshot().current;
        if (disposed || current?.provider !== 'shanghaitech-genai' || ctx.sessions.subagentAddress(sessionId) !== undefined) return;
        const turn = ++generation;
        active?.abort(); active = new AbortController();
        publish({status:'loading',error:false,value:null,model:current.model});
        try {
          const value = await rpc('shanghaitech.options.get', {sessionId,model:current.model,...activate===true?{activate:true}:{}}, active.signal);
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
          clearWebsiteDrafts();
          identity = nextIdentity; ++generation; active?.abort();
          publish({value:null,error:false,status:'idle'});
          if (visible) void reload(true);
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
      function canPickFiles() {
        const state = store.getSnapshot();
        return !disposed && attachmentPickers.size > 0 && state.visible && state.status === 'ready' && !state.modelPending;
      }
      function pickFiles() {
        if (canPickFiles()) Array.from(attachmentPickers).at(-1)();
      }
      const unsubscribe = directory.store.subscribe(sync);
      const reset = ctx.on('connection/reset', () => { identity = undefined; sync(); });
      sync();
      return {hooks:{options:store}, selectOptions, reload, enterView, canPickFiles, pickFiles, registerDrafts(drafts, actions) {for (const draft of drafts) websiteDrafts.set(draft.id, actions);}, dispose() {disposed=true;++generation;active?.abort();unsubscribe();reset();}};
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
          return {hooks:value.hooks,selectOptions:value.selectOptions,reload:value.reload,enterView:value.enterView,
            addWebsiteAttachments(files,actions) {
              const state=value.hooks.options.getSnapshot();
              if(!state.visible||state.modelPending||state.status!=='ready')throw Error('attachmentsNotReady');
              for(const file of files){
                const ext=file.name.split('.').pop().toLowerCase();
                const image=['png','jpg','jpeg','webp','gif'].includes(ext);
                if(!image&&!['pdf','txt','csv','docx','xls','xlsx','ppt','pptx','html','htm','md','markdown','log','json'].includes(ext))throw Error('attachmentsFormat');
                if(!file.size||file.size>=10*1024*1024)throw Error('attachmentsSize');
              }
              // Exact-byte file receipts preserve GIFs and avoid DSH's normal
              // image normalization. Storage, cancellation and access stay DSH-owned.
              const drafts=ctx.conversation.createDrafts(sessionId,files.map(file=>new File([file],file.name,{type:'application/octet-stream'})));
              if(!actions.addAttachments(drafts.map(draft=>draft.id))){ctx.conversation.releaseDraftAttachments(drafts);throw Error('attachmentsLocked');}
              value.registerDrafts(drafts,actions);
            }};
        }
        ctx.effect(() => ctx.locale.register(NS, {
          en:{"gatewayShowKey":"Show key","gatewayHideKey":"Hide key","gatewayUnsaved":"Unsaved changes. Requests still use the saved key.","gatewayTitle":"Gateway connection","gatewayKey":"Gateway key","gatewayKeyKeep":"Leave blank to keep the saved key","gatewayKeyPlaceholder":"Enter the gateway key","gatewayKeyConfigured":"The current key used for gateway requests. Changes take effect after saving.","gatewayKeyHelp":"Enter the access key for your gateway.","gatewayAddress":"Remote host address (optional)","gatewayAddressHelp":"Leave blank for local 127.0.0.1:8000. Accepts a hostname, IP, host:port or full HTTP(S) URL. Bare hosts use port 8000.","gatewaySave":"Save","gatewayWorking":"Working…","gatewaySaved":"Saved. Subsequent requests use the new settings.","invalidAddress":"Enter a valid host or HTTP(S) URL without credentials, query or fragment.","invalidSettings":"Invalid settings. Reload and try again.","invalidKey":"Use a gateway key with 32–4096 non-whitespace ASCII characters.","keyRequired":"Enter a gateway key.","settingsChanged":"Settings changed in another window. Reload before saving.","settingsUnavailable":"Could not read or save gateway settings. Reload and try again.",localDeleteFailed:'Website history was deleted, but local cleanup did not finish. Reload to inspect the local session.',deletedIndexWarning:'Session deleted. Search index refresh is pending; do not delete the session again.',deleteSession:'Delete session',deleteConfirm:'Permanently delete “{title}” and its subagents? This cannot be undone.',deleteWebsite:'Also delete website history',deleteConfirmButton:'Permanently delete',deleteCancel:'Cancel',deleting:'Deleting…',deleted:'Session deleted.',deleteFailed:'Deletion did not complete. Reload to inspect the result. Website failures retain the local session; uncheck website history only if local-only deletion is intended.',label:'ShanghaiTech GenAI options',search:'Search',thinking:'Thinking',attachments:'Website attachments',loading:'Loading options…',retry:'Reload',saveFailed:'Options unavailable or not saved. Reload to retry.',searchHelp:'Use the original website’s web search for the next request.',thinkingHelp:'Use the original website’s deep thinking for the next request.',attachmentsHelp:'Use the original website’s image upload and document parsing. Original files are uploaded when you send. Images <10 MiB; documents <10 MiB.',attachmentsNotReady:'Wait for the current model to be ready before adding attachments.',attachmentsFormat:'Supported images: PNG, JPEG, WebP, GIF. Website documents: PDF, TXT, CSV, DOCX, XLS, XLSX, PPT, PPTX, HTML, HTM, MD, MARKDOWN, LOG, JSON.',attachmentsSize:'Select nonempty images below 10 MiB or documents below 10 MiB.',attachmentsLocked:'The input is locked. Try adding attachments later.'},
          zh:{"gatewayShowKey":"显示密钥","gatewayHideKey":"隐藏密钥","gatewayUnsaved":"有未保存的修改，请求仍使用已保存的密钥。","gatewayTitle":"网关连接","gatewayKey":"网关密钥","gatewayKeyKeep":"留空保留已保存的密钥","gatewayKeyPlaceholder":"输入网关密钥","gatewayKeyConfigured":"当前请求使用的网关密钥；修改后点击保存生效。","gatewayKeyHelp":"填写网关的访问密钥。","gatewayAddress":"远程主机地址（可选）","gatewayAddressHelp":"留空连接本地 127.0.0.1:8000。支持主机名、IP、主机:端口或完整 HTTP(S) 地址；仅填主机时使用 8000 端口。","gatewaySave":"保存","gatewayWorking":"处理中…","gatewaySaved":"已保存，后续请求使用新配置。","invalidAddress":"请输入有效的主机地址或 HTTP(S) URL，不包含账号、密码、查询参数或片段。","invalidSettings":"配置格式无效，请重新载入。","invalidKey":"网关密钥须为 32–4096 个非空格 ASCII 字符。","keyRequired":"请输入网关密钥。","settingsChanged":"配置已在其他窗口更新，请重新载入后保存。","settingsUnavailable":"无法读取或保存网关配置，请重新载入后重试。",localDeleteFailed:'网站历史已删除，但本地清理未完成，请重新载入核对本地会话。',deletedIndexWarning:'会话已删除，搜索索引暂未刷新，无需重复删除。',deleteSession:'删除会话',deleteConfirm:'永久删除「{title}」及其子代理会话？删除后不可恢复。',deleteWebsite:'同时删除网站历史',deleteConfirmButton:'永久删除',deleteCancel:'取消',deleting:'正在删除…',deleted:'会话已删除。',deleteFailed:'删除未完成，请重新载入核对。网站删除失败时保留本地会话；仅需删除本地时可取消勾选网站历史。',label:'ShanghaiTech GenAI 选项',search:'联网搜索',thinking:'深度思考',attachments:'网页附件',loading:'载入选项…',retry:'重新载入',saveFailed:'选项不可用或未保存，请重新载入。',searchHelp:'直接调用原网页的联网搜索功能，用于下一次请求。',thinkingHelp:'直接调用原网页的深度思考功能，用于下一次请求。',attachmentsHelp:'直接调用原网页的图片上传与文档解析功能，发送时上传原文件。图片 <10 MiB；文档 <10 MiB。',attachmentsNotReady:'请等待当前模型就绪后添加附件。',attachmentsFormat:'支持图片：PNG、JPEG、WebP、GIF；网页文档：PDF、TXT、CSV、DOCX、XLS、XLSX、PPT、PPTX、HTML、HTM、MD、MARKDOWN、LOG、JSON。',attachmentsSize:'请选择非空文件，图片须小于 10 MiB，文档须小于 10 MiB。',attachmentsLocked:'当前输入已锁定，请稍后再添加附件。'},
        }), 'ShanghaiTech: option labels');
        ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register({name:'plugins.bundle.config',key:'dsh-shanghaitech-genai',locale:NS,
          inject:() => ({rpc:(action,payload,signal) => ctx.connection.rpc.call('/api','shanghaitech.gateway.'+action,payload,signal)})}, GatewaySettings));
        ctx.slots.inject('conversation.input.left', () => ctx.slots.register({
          name:'conversation.input.left', id:'shanghaitech-options', order:20, locale:NS, inject:face,
        }, Options));
        ctx.inject(['commandUi'], scope => {
          const t = ctx.locale.bind(NS);
          scope.effect(() => scope.commandUi.register({
            name:'shanghaitech-attach',
            label:() => t('attachments'),
            description:() => t('attachmentsHelp'),
            icon:IconPaperclipOutlineRegular,
            available:({sessionId}) => controllers.get(sessionId)?.canPickFiles() === true,
            ui:{kind:'action', run:({sessionId}) => controllers.get(sessionId)?.pickFiles()},
          }), 'ShanghaiTech: website attachment command');
        });
        ctx.inject(['contextMenus'], installSessionDeletion);
      },
    };
  },
});
