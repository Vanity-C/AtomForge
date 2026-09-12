/**
 * Sandboxed preview of a generated multi-file React app.
 *
 * The iframe receives only file contents (never tokens). Inside the sandbox a
 * tiny module registry resolves relative imports, Babel compiles each module on
 * the fly, and any compile/runtime error is reported back to the parent.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Loader2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {cloudRequest, type Artifact} from '@/lib/studio';
import type { GeneratedFile } from '@/lib/agent/codegen';

const REACT_URL = '/preview-vendor/react.js';
const REACT_DOM_URL = '/preview-vendor/react-dom.js';
const BABEL_URL = '/preview-vendor/babel.js';

function buildDocument(files: GeneratedFile[], channel: string, storage: Record<string, string>, artifact?: Artifact): string {
  const modules: Record<string, string> = {};
  let css = '';
  for (const file of files) {
    if (file.path.endsWith('.css')) {
      css += `\n/* ${file.path} */\n${file.content}\n`;
    } else if (/\.(jsx|js)$/.test(file.path)) {
      modules[file.path] = file.content;
    }
  }

  if (artifact) css = artifact.css;
  const payload = JSON.stringify({ storage, modules, artifact, entry: 'App.jsx' })
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e');
  const vendorScripts=artifact?'':`<script src="${REACT_URL}"></script><script src="${REACT_DOM_URL}"></script><script src="${BABEL_URL}"></script>`;

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<style>
  *, *::before, *::after { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    font-family: 'Manrope', -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
    background: #ffffff;
    color: #16182b;
    min-height: 100vh;
  }
  #root { min-height: 100vh; }
  .af-error {
    margin: 0; padding: 20px 22px; font-family: ui-monospace, SFMono-Regular, monospace;
    font-size: 12.5px; line-height: 1.7; color: #8a1c2b; background: #fdf2f3;
    border-bottom: 1px solid #f3ccd2; white-space: pre-wrap;
  }
</style>
<style id="af-user-style">${css.replace(/<\/style/gi, '<\\/style')}</style>
${vendorScripts}
</head>
<body>
<div id="root"></div>
<script>
(function () {
  var CHANNEL = ${JSON.stringify(channel)};
  var BUNDLE = ${payload};
  window.__AF_CHANNEL__ = CHANNEL;
  var editing = false;
  window.addEventListener('message', function(e) {
    if(e.source === parent && e.data && e.data.channel === CHANNEL && e.data.source === 'atomforge-edit-mode') editing = !!e.data.enabled;
  });
  document.addEventListener('click', function(e) {
    if(!editing) return;
    var element = e.target.closest('[data-af-source]');
    if(!element) return;
    e.preventDefault(); e.stopImmediatePropagation();
    parent.postMessage({source:'atomforge-element',channel:CHANNEL,selection:{source:element.getAttribute('data-af-source'),text:element.children.length ? null : element.textContent,tag:element.tagName}}, '*');
  }, true);

  function report(kind, message) {
    try {
      parent.postMessage({ source: 'atomforge-preview', channel: CHANNEL, kind: kind, message: String(message) }, '*');
    } catch (e) { /* ignore */ }
  }

  var failed = false;
  var saved = Object.assign(Object.create(null), BUNDLE.storage);
  var store = {
    getItem: function(k) { k = String(k); return Object.prototype.hasOwnProperty.call(saved, k) ? saved[k] : null; },
    setItem: function(k, v) {
      var next = Object.assign(Object.create(null), saved); next[String(k)] = String(v);
      if (JSON.stringify(next).length > 200000) throw new Error('应用数据超过保存上限');
      saved = next; persist();
    },
    removeItem: function(k) { delete saved[String(k)]; persist(); },
    clear: function() { saved = Object.create(null); persist(); },
    key: function(i) { return Object.keys(saved)[i] || null; },
    get length() { return Object.keys(saved).length; }
  };
  function persist() {
    parent.postMessage({source:'atomforge-preview', channel:CHANNEL, kind:'storage', storage:saved}, '*');
  }
  Object.defineProperty(window, 'localStorage', {value:store, configurable:false});

  function showError(message) {
    failed = true;
    var box = document.getElementById('af-error');
    if (!box) {
      box = document.createElement('pre');
      box.id = 'af-error';
      box.className = 'af-error';
      document.body.insertBefore(box, document.body.firstChild);
    }
    box.textContent = message;
  }

  window.addEventListener('error', function (event) {
    var msg = (event && event.message) || '运行时错误';
    showError('运行时错误：' + msg);
    report('runtime-error', msg);
  });
  window.addEventListener('unhandledrejection', function (event) {
    var reason = (event && event.reason && (event.reason.message || event.reason)) || '未处理的 Promise 异常';
    showError('运行时错误：' + reason);
    report('runtime-error', reason);
  });

  if (BUNDLE.artifact) {
    try {
      new Function(BUNDLE.artifact.js)();
      var checks = 0;
      var mounted = setInterval(function() {
        if (document.getElementById('root').childElementCount) { clearInterval(mounted); if (!failed) report('ready', 'ok'); }
        else if (++checks > 100) { clearInterval(mounted); report('runtime-error', '应用没有渲染内容'); }
      }, 50);
    } catch (error) {showError(error.message);report('runtime-error',error.message);}
    return;
  }
  if (!window.React || !window.ReactDOM || !window.Babel) {
    showError('预览依赖加载失败，请检查网络后点击刷新重试。');
    report('runtime-error', 'preview dependencies failed to load');
    return;
  }

  var R = window.React;
  var HOOK_NAMES = ['useState','useEffect','useMemo','useRef','useCallback','useReducer','useContext','useLayoutEffect','createContext','memo','forwardRef','Fragment','useId','useTransition','useDeferredValue'];
  HOOK_NAMES.forEach(function (name) { if (R[name]) window[name] = R[name]; });
  window.React = R;

  var registry = {};
  var cache = {};

  Object.keys(BUNDLE.modules).forEach(function (path) {
    registry[normalize(path)] = BUNDLE.modules[path];
  });

  function normalize(p) {
    return String(p).replace(/^\\.\\//, '').replace(/^\\/+/, '');
  }

  function joinPath(fromPath, request) {
    if (!/^[.]/.test(request)) return normalize(request);
    var baseParts = normalize(fromPath).split('/');
    baseParts.pop();
    var parts = request.split('/');
    for (var i = 0; i < parts.length; i += 1) {
      var seg = parts[i];
      if (seg === '.' || seg === '') continue;
      if (seg === '..') { baseParts.pop(); continue; }
      baseParts.push(seg);
    }
    return baseParts.join('/');
  }

  function resolve(candidate) {
    var variants = [candidate, candidate + '.jsx', candidate + '.js', candidate + '/index.jsx', candidate + '/index.js'];
    for (var i = 0; i < variants.length; i += 1) {
      if (registry[variants[i]] !== undefined) return variants[i];
    }
    return null;
  }

  function requireModule(fromPath, request) {
    if (/\\.css$/.test(request)) return {};
    if (request === 'react') return R;
    if (request === 'react-dom' || request === 'react-dom/client') return window.ReactDOM;
    var target = resolve(joinPath(fromPath, request));
    if (!target) {
      throw new Error('找不到模块 "' + request + '"（来自 ' + fromPath + '）。请确认文件名与引用路径一致。');
    }
    return loadModule(target);
  }

  function loadModule(path) {
    if (cache[path]) return cache[path].exports;
    var moduleObj = { exports: {} };
    cache[path] = moduleObj;
    var source = registry[path];
    var compiled;
    try {
      compiled = window.Babel.transform(source, {
        presets: [['react', { runtime: 'classic' }]],
        plugins: ['transform-modules-commonjs'],
        filename: path,
        sourceType: 'module'
      }).code;
    } catch (err) {
      delete cache[path];
      throw new Error('编译失败 [' + path + ']：' + (err && err.message ? err.message : err));
    }
    try {
      var factory = new Function('require', 'module', 'exports', 'React', compiled);
      factory(function (req) { return requireModule(path, req); }, moduleObj, moduleObj.exports, R);
    } catch (err) {
      delete cache[path];
      throw new Error('执行失败 [' + path + ']：' + (err && err.message ? err.message : err));
    }
    return moduleObj.exports;
  }

  try {
    var entry = resolve(BUNDLE.entry);
    if (!entry) throw new Error('项目中没有可运行的 .jsx 文件。');
    var exported = loadModule(entry);
    var Component = exported && (exported.default || exported.App || exported);
    if (typeof Component !== 'function') {
      throw new Error(entry + ' 需要使用 export default 导出一个 React 组件。');
    }
    function Mounted() {
      R.useEffect(function() { requestAnimationFrame(function() { if (!failed) report('ready', 'ok'); }); }, []);
      return R.createElement(Component);
    }
    class Boundary extends R.Component {
      constructor(props) { super(props); this.state = {error: false}; }
      static getDerivedStateFromError() { return {error: true}; }
      componentDidCatch(error) { showError(error.message); report('runtime-error', error.message); }
      render() { return this.state.error ? null : this.props.children; }
    }
    window.ReactDOM.createRoot(document.getElementById('root')).render(R.createElement(Boundary, null, R.createElement(Mounted)));
  } catch (err) {
    var message = err && err.message ? err.message : String(err);
    showError(message);
    report('compile-error', message);
  }
})();
</script>
</body>
</html>`;
}

export interface PreviewFrameProps {
  files: GeneratedFile[];
  className?: string;
  artifact?: Artifact;
  cloudSlug?: string | null;
  onElementSelect?: (selection:{source:string;text:string|null;tag:string})=>void;
  storageKey: string;
  onStatusChange?: (status: 'idle' | 'ready' | 'error', message: string) => void;
}

export default function PreviewFrame({ files, className, storageKey, onStatusChange, artifact, cloudSlug, onElementSelect }: PreviewFrameProps) {
  const [nonce, setNonce] = useState(0);
  const [editMode, setEditMode] = useState(false);
  const [checkoutUrl,setCheckoutUrl]=useState('');
  const [device, setDevice] = useState('desktop');
  const selectRef = useRef(onElementSelect);selectRef.current=onElementSelect;
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [errorText, setErrorText] = useState('');
  const frameRef = useRef<HTMLIFrameElement>(null);
  const onStatusRef = useRef(onStatusChange);
  onStatusRef.current = onStatusChange;
  const runnable = useMemo(() => files.filter(f => /\.(jsx|js|tsx|ts|css)$/.test(f.path) && f.content.trim()), [files]);
  const hasPreview = !!(runnable.length || artifact);
  const document = useMemo(() => {
    const channel = crypto.randomUUID();
    let storage: Record<string, string> = {};
    try { storage = JSON.parse(localStorage.getItem(`atomforge.preview.${storageKey}`) || '{}'); } catch { /* empty */ }
    return {channel, html: buildDocument(runnable, channel, storage, artifact)};
    // nonce explicitly requests a new frame, even when files are unchanged.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runnable, storageKey, nonce, artifact]);

  useEffect(() => {
    setCheckoutUrl(''); setEditMode(false); setStatus('loading'); setErrorText(''); onStatusRef.current?.('idle', '');
    if (!hasPreview) return;
    let failed = false;
    const timeout = setTimeout(() => {
      setStatus('error'); setErrorText('预览加载超时，请重新运行');
      onStatusRef.current?.('error', '预览加载超时，请重新运行');
    }, 20000);
    const handler = (event: MessageEvent) => {
      if (event.source !== frameRef.current?.contentWindow) return;
      const data = event.data;
      if (data?.channel !== document.channel) return;
      if (data.source === 'atomforge-element') {selectRef.current?.(data.selection);return;}
      if (data.source === 'atomforge-cloud-request') {
        const target = event.source as Window;
        const reply = (result: unknown, error?: string) => target.postMessage({source:'atomforge-cloud-response',channel:document.channel,id:data.id,result,error}, '*');
        if (!cloudSlug) {reply(null, '请先在项目设置中开启云服务');return;}
        void cloudRequest(cloudSlug, String(data.action), data.data || {}).then(result=>{
          if(data.action==='checkout'&&typeof result?.url==='string'&&new URL(result.url).origin==='https://checkout.stripe.com')setCheckoutUrl(result.url);
          reply(result);
        }).catch(e=>reply(null, e.message));
        return;
      }
      if (data.source !== 'atomforge-preview') return;
      if (data.kind === 'storage') {
        try {
          if (!data.storage || Array.isArray(data.storage) || typeof data.storage !== 'object') return;
          if (Object.values(data.storage).some(v => typeof v !== 'string')) return;
          const value = JSON.stringify(data.storage);
          if (value.length <= 200000) localStorage.setItem(`atomforge.preview.${storageKey}`, value);
        } catch {
          setErrorText('浏览器存储空间不足，应用数据未能保存'); setStatus('error');
        }
        return;
      }
      clearTimeout(timeout);
      if (data.kind === 'ready' && !failed) {
        setStatus('ready'); setErrorText(''); onStatusRef.current?.('ready', '');
      } else if (data.kind === 'runtime-error' || data.kind === 'compile-error') {
        failed = true; setStatus('error'); setErrorText(String(data.message || '运行错误'));
        onStatusRef.current?.('error', String(data.message || '运行错误'));
      }
    };
    window.addEventListener('message', handler);
    return () => { clearTimeout(timeout); window.removeEventListener('message', handler); };
  }, [document, storageKey, cloudSlug, hasPreview]);

  if (!runnable.length && !artifact) {
    return (
      <div className={`flex h-full flex-col items-center justify-center gap-2 bg-muted/40 p-8 text-center ${className ?? ''}`}>
        <p className="text-sm font-medium text-foreground">还没有可预览的应用</p>
        <p className="max-w-xs text-sm text-muted-foreground">
          在左侧告诉智能体你想要什么，生成完成后应用会在这里真实运行。
        </p>
      </div>
    );
  }

  return (
    <div className={`relative flex h-full flex-col ${className ?? ''}`}>
      <div className="flex items-center justify-between gap-3 border-b border-border bg-card px-3 py-2">
        <div className="flex items-center gap-2 text-xs">
          <span
            className={`inline-block h-2 w-2 rounded-full ${
              status === 'ready'
                ? 'bg-success'
                : status === 'error'
                  ? 'bg-destructive'
                  : 'bg-muted-foreground/50'
            }`}
          />
          <span className="text-muted-foreground">
            {status === 'ready' ? '运行中' : status === 'error' ? '运行出错' : '正在编译…'}
          </span>
          <span className="text-muted-foreground/60">·</span>
          <span className="tnum text-muted-foreground">{runnable.length?runnable.length+' 个文件':'已构建应用'}</span>
        </div>
        <div className="flex gap-1">
        <select aria-label="预览设备" className="max-w-20 rounded border bg-background text-xs" value={device} onChange={e=>setDevice(e.target.value)}><option value="desktop">桌面</option><option value="tablet">平板</option><option value="mobile">手机</option></select>
        {onElementSelect&&artifact&&<Button size="sm" variant={editMode?'default':'outline'} className="h-7 px-2 text-xs" onClick={()=>{const next=!editMode;setEditMode(next);frameRef.current?.contentWindow?.postMessage({source:'atomforge-edit-mode',channel:document.channel,enabled:next},'*');}}>{editMode?'退出选取':'选取元素'}</Button>}
        <Button
          size="sm"
          variant="ghost"
          className="h-7 gap-1.5 px-2 text-xs"
          onClick={() => setNonce((n) => n + 1)}
        >
          <RefreshCw className="h-3.5 w-3.5" />
          重新运行
        </Button></div>
      </div>

      {status === 'error' && errorText ? (
        <div className="flex items-start gap-2 border-b border-destructive/25 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <pre className="max-h-24 overflow-auto whitespace-pre-wrap font-mono leading-relaxed">
            {errorText}
          </pre>
        </div>
      ) : null}

      {checkoutUrl&&<div className="flex items-center justify-between border-b bg-card p-3 text-sm"><a href={checkoutUrl} target="_blank" rel="noopener noreferrer" className="font-medium text-primary underline">继续付款 · Stripe</a><Button variant="ghost" size="sm" onClick={()=>setCheckoutUrl('')}>关闭</Button></div>}
      <div className="relative flex-1 bg-white">
        {status === 'loading' ? (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center gap-2 bg-white/70 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            正在编译并运行应用…
          </div>
        ) : null}
        <iframe
          ref={frameRef}
          key={document.channel}
          title="生成的应用预览"
          srcDoc={document.html}
          sandbox="allow-scripts allow-forms allow-popups allow-modals"
          style={{maxWidth:device==='mobile'?390:device==='tablet'?768:'100%',margin:'0 auto',display:'block'}}
          className="h-full w-full border-0"
        />
      </div>
    </div>
  );
}
