import {useEffect,useState} from 'react';
import {Link,useNavigate,useSearchParams} from 'react-router-dom';
import {Loader2,ShieldCheck} from 'lucide-react';
import {completeOAuth,resolveOAuthTransfer,errorMessage,type OAuthTransfer} from '@/lib/sdk';
import AuthShell from '@/components/AuthShell';
import {Button} from '@/components/ui/button';
import {toast} from 'sonner';
export default function AuthCallback(){
  const [params]=useSearchParams();const navigate=useNavigate();const [error,setError]=useState(params.get('error')||'');
  const [transfer,setTransfer]=useState<OAuthTransfer|null>(null);
  const [busy,setBusy]=useState(false);const [transferError,setTransferError]=useState('');
  const ticket=params.get('ticket')||'';
  const providerName=transfer?({github:'GitHub',gitee:'Gitee',netlify:'Netlify'}[transfer.provider]||transfer.provider):'';
  useEffect(()=>{
    if(error)return;
    if(!ticket){setError('授权凭证缺失，请重新登录');return;}
    let active=true;
    void completeOAuth(ticket).then(result=>{
      if(!active)return;
      if(typeof result==='string')navigate(result,{replace:true});else setTransfer(result);
    }).catch(e=>{if(active)setError(errorMessage(e));});
    return()=>{active=false;};
  },[ticket,error,navigate]);
  async function resolve(confirm:boolean){
    if(busy)return;
    setBusy(true);setTransferError('');
    try{
      const path=await resolveOAuthTransfer(ticket,confirm);
      toast.success(confirm?providerName+' 已连接到当前账号，原账号已自动解绑':'已取消，原有绑定保持不变');
      navigate(path,{replace:true});
    }catch(e){setTransferError(errorMessage(e));}finally{setBusy(false);}
  }
  return <AuthShell>
    <div className="auth-callback-icon"><ShieldCheck size={24}/></div>
    <div className="auth-form-heading"><h1>{error?'授权尚未完成':transfer?`将 ${providerName} 连接到此账号？`:'正在连接你的账号'}</h1><p>{error?'这次授权尚未完成，你可以重新选择登录方式。':transfer?`这个 ${providerName} 已连接到另一个 AtomForge 账号。`:'马上就能回到你的创作空间。'}</p></div>
    {error?<><p role="alert" className="auth-callback-copy">{error}</p><div className="auth-callback-links"><Link to="/auth">返回登录 →</Link><Link to="/account">返回账号设置</Link></div></>:transfer?<>
      <div className="rounded-xl border bg-muted/30 p-4 space-y-3 text-sm leading-relaxed">
        <p><strong>{providerName} {transfer.login}</strong> 将连接到当前账号 <strong>{transfer.target_name}</strong>。</p>
        <p className="text-muted-foreground">{transfer.provider==='netlify'?'确认后，原 AtomForge 账号将自动解绑，无法再使用此 Netlify 连接部署项目。已部署的网站保持不变。':`确认后，原 AtomForge 账号将自动解绑，无法再通过这个 ${providerName} 登录或使用此连接发布仓库。原账号需通过其他登录方式访问。`}</p>
        <p className="text-muted-foreground">两个账号的项目和数据各自保留，不会合并或迁移。</p>
      </div>
      {transferError&&<p role="alert" className="auth-callback-copy">{transferError}</p>}
      <div className="mt-6 flex flex-col gap-3">
        <Button disabled={busy} onClick={()=>void resolve(true)}>{busy&&<Loader2 className="mr-2 h-4 w-4 animate-spin"/>}确认转移并连接</Button>
        <Button variant="outline" disabled={busy} onClick={()=>void resolve(false)}>取消，保留原绑定</Button>
      </div>
      <div className="auth-callback-links"><Link to="/account">返回账号设置</Link></div>
    </>:<p className="auth-callback-copy flex items-center gap-2" role="status"><Loader2 className="h-4 w-4 animate-spin"/>正在完成安全验证…</p>}
  </AuthShell>;
}
