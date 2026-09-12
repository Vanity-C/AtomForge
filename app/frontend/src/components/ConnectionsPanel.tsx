import {useEffect,useState} from 'react';
import {Input} from '@/components/ui/input';
import {Button} from '@/components/ui/button';
import {invoke,errorMessage} from '@/lib/sdk';
import {toast} from 'sonner';
const fields=[['stripe_secret','Stripe Secret Key（建议先用测试模式）'],['stripe_price_id','Stripe 一次性付款 Price ID'],['stripe_webhook_secret','Stripe Webhook Signing Secret'],['public_base_url','应用公网根地址（https://…）'],['tavily_key','Tavily API Key（联网研究）']];
const secrets=new Set(['stripe_secret','stripe_webhook_secret','tavily_key']);
export default function ConnectionsPanel({projectId}:{projectId:number}){
  const [values,setValues]=useState<Record<string,string>>({});const [configured,setConfigured]=useState<Record<string,boolean>>({});const [busy,setBusy]=useState(false);const [denied,setDenied]=useState(false);
  const url=`/api/v1/connections/projects/${projectId}`;
  const load=async()=>{try{const r=await invoke<Record<string,string|boolean>>({url});setValues(Object.fromEntries(fields.map(([k])=>[k,String(r[k]||'')])));setConfigured(Object.fromEntries([...secrets].map(k=>[k,!!r[k+'_configured']])));}catch{setDenied(true);}};
  useEffect(()=>{void load();},[projectId]); // eslint-disable-line react-hooks/exhaustive-deps
  const perform=async(fn:()=>Promise<void>)=>{setBusy(true);try{await fn();}catch(e){toast.error(errorMessage(e));}finally{setBusy(false);}};
  if(denied)return <p className="text-xs text-muted-foreground">外部服务凭据由项目所有者管理。</p>;
  return <section className="border-t pt-4"><h3 className="font-semibold">外部服务</h3><p className="my-2 text-xs text-muted-foreground">密钥在服务端加密保存。留空保留已有密钥，页面不回显密钥。</p>
    <div className="space-y-3">{fields.map(([key,label])=><label key={key} className="block text-xs">{label}{configured[key]?' · 已配置':''}<Input className="mt-1" type={secrets.has(key)?'password':'text'} autoComplete="off" value={values[key]||''} onChange={e=>setValues({...values,[key]:e.target.value})}/></label>)}</div>
    <div className="my-3 flex flex-wrap gap-2"><Button disabled={busy} onClick={()=>void perform(async()=>{await invoke({url,method:'PUT',data:Object.fromEntries(Object.entries(values).filter(([k,v])=>!secrets.has(k)||v.trim()))});await load();toast.success('连接配置已保存');})}>保存连接配置</Button><Button variant="outline" disabled={busy} onClick={()=>void perform(async()=>{await invoke({url,method:'DELETE'});await load();toast.success('已清除连接配置');})}>清除全部项目密钥</Button></div>
    <p className="mt-3 break-all text-xs text-muted-foreground">Stripe 回调地址：{values.public_base_url||'https://你的公网域名'}/api/v1/connections/stripe/{projectId}/webhook</p><p className="mt-1 text-xs text-muted-foreground">接收 checkout.session.completed 和 checkout.session.async_payment_succeeded。启用云服务、发布应用后，可让智能体添加登录与支付按钮。支付成功以签名验证的回调为准。</p>
  </section>;
}
