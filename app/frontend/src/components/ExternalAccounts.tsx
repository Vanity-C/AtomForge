import {useCallback,useEffect,useState} from 'react';
import {Github,GitBranch,Globe,Loader2,Check} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {invoke,errorMessage} from '@/lib/sdk';

export interface ExternalProvider{id:string;name:string;configured:boolean;connected:boolean;login:string;publish_authorized:boolean;callback_url:string;configuration_issue?:string}
export default function ExternalAccounts({login=false,redirect='/account',only}:{login?:boolean;redirect?:string;only?:string[]}){
  const [items,setItems]=useState<ExternalProvider[]>([]);const [busy,setBusy]=useState('');const [error,setError]=useState('');const [loading,setLoading]=useState(true);
  const load=useCallback(async()=>{setLoading(true);setError('');try{const r=await invoke<{items:ExternalProvider[]}>({url:'/api/v1/af-auth/oauth/providers',auth:!login});setItems(r.items);}catch(e){setError(errorMessage(e));}finally{setLoading(false);}},[login]);
  useEffect(()=>{void load();},[load]);
  const begin=async(provider:string)=>{setBusy(provider);setError('');try{const r=await invoke<{url:string}>({url:`/api/v1/af-auth/oauth/${provider}/start`,method:'POST',auth:!login,data:{purpose:login?'login':'connect',redirect}});window.location.assign(r.url);}catch(e){setError(errorMessage(e));setBusy('');}};
  const visible=items.filter(p=>login?p.id!=='netlify':!only||only.includes(p.id));
  if(login){
    const buttons=visible.length?visible:[{id:'github',name:'GitHub',configured:false},{id:'gitee',name:'Gitee',configured:false}];
    const unavailable=visible.filter(p=>!p.configured).map(p=>p.name);
    return <section aria-label="第三方登录"><div className="auth-social-list">{buttons.map(p=><button key={p.id} type="button" className="auth-social-button" disabled={loading||!!busy} aria-disabled={!p.configured||loading||!!busy} aria-label={`使用 ${p.name} 继续`} onClick={()=>{if(!visible.length){void load();return;}if(!p.configured){setError(`${p.name} 登录尚未在本站开通，请先使用邮箱登录或注册。`);return;}void begin(p.id);}}>{busy===p.id?<Loader2 size={17} className="animate-spin"/>:p.id==='github'?<Github size={18}/>:<span aria-hidden="true" className="font-bold text-base text-[#c64745]">G</span>}<span>使用 {p.name} 继续</span>{!loading&&visible.length>0&&!p.configured&&<small>未开通</small>}</button>)}</div>
      {loading&&<p className="auth-social-notice" role="status">正在检查登录方式…</p>}
      {!loading&&!!unavailable.length&&!error&&<p className="auth-social-notice">{unavailable.join(' / ')} 暂未开通，邮箱登录与注册可正常使用。</p>}
      {error&&<p role="alert" className="auth-social-error">{error}</p>}
      {!loading&&(!!error||!!unavailable.length)&&<button type="button" className="auth-social-retry" onClick={()=>void load()}>重新检查登录方式</button>}
    </section>;
  }
  return <section className="space-y-3" aria-label="第三方账号连接">
    <div><h3 className="font-semibold">连接你的账号</h3><p className="mt-1 text-xs leading-5 text-muted-foreground">GitHub／Gitee 用于登录和源码发布，Netlify 用于部署公网应用。</p></div>
    {loading&&<p className="text-xs text-muted-foreground">正在读取连接状态…</p>}
    <div className="space-y-2">{visible.map(p=>{const Icon=p.id==='github'?Github:p.id==='gitee'?GitBranch:Globe;return <div key={p.id} className="flex items-center gap-3 rounded-xl border bg-background p-3"><Icon className="h-5 w-5 shrink-0"/><div className="min-w-0 flex-1"><p className="text-sm font-medium">{p.name}</p><p className="truncate text-xs text-muted-foreground">{p.connected?p.login:p.configured?'尚未连接':p.configuration_issue==='origin_missing'?'尚未配置网站回调地址':'尚未配置 OAuth 应用凭据'}</p></div><Button type="button" variant="outline" size="sm" disabled={!!busy||!p.configured} onClick={()=>void begin(p.id)}>{busy===p.id?<Loader2 className="mr-1 h-4 w-4 animate-spin"/>:p.connected?<Check className="mr-1 h-3 w-3"/>:null}{p.connected?(p.id!=='netlify'&&!p.publish_authorized?'授权发布':'重新授权'):'连接'}</Button></div>;})}</div>
    {error&&<p role="alert" className="mt-2 text-xs text-destructive">{error}</p>}
    {(error||visible.some(p=>!p.configured))&&<Button variant="ghost" size="sm" disabled={loading} onClick={()=>void load()}>重新检查连接</Button>}
    {visible.some(p=>!p.configured)&&<details className="text-xs text-muted-foreground"><summary className="cursor-pointer">管理员接入说明</summary><p className="mt-2 leading-6">在对应平台创建 OAuth 应用，回调地址填写下方完整地址。本地可运行 configure-oauth.ps1 安全填写应用凭据；生产环境配置对应的 CLIENT_ID、CLIENT_SECRET 和 ATOMFORGE_PUBLIC_ORIGIN 后重启服务。个人访问令牌不能代替 OAuth 应用凭据。</p>{visible.some(p=>p.id==='netlify'&&!p.configured)&&<p className="mt-2 leading-6">Netlify：打开<a href="https://app.netlify.com/user/applications" target="_blank" rel="noreferrer" className="text-primary underline">应用设置</a>，在 OAuth applications 中创建应用，再运行 <code>.\configure-oauth.ps1 -Provider netlify</code> 输入 Client ID 和 Client Secret。Secret 在终端中隐藏输入，不会显示在此页面。重启后端后点击“重新检查连接”。</p>}{visible.map(p=><p key={p.id} className="mt-2 break-all">{p.name} 回调：{p.callback_url||`/api/v1/af-auth/oauth/${p.id}/callback`}</p>)}</details>}
  </section>;
}
