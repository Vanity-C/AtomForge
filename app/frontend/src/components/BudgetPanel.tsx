import {useState} from 'react';
import {useRecoveringQuery} from '@/hooks/useRecoveringQuery';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {invoke} from '@/lib/sdk';
import {toast} from 'sonner';
interface Budget{token_limit:number;used_tokens:number;month:string;estimated_cost:number;unpriced_usage:boolean;prices:Record<string,{input:number;output:number}>}
export default function BudgetPanel(){
  const query=useRecoveringQuery<Budget>('/api/v1/studio/budget');
  const [draft,setDraft]=useState<Pick<Budget,'token_limit'|'prices'>>();
  const [saving,setSaving]=useState(false);
  const [notice,setNotice]=useState('');
  const data=query.data?{...query.data,...draft}:undefined;
  const setData=(next:Budget)=>setDraft({token_limit:next.token_limit,prices:next.prices});
  const save=async()=>{
    if(!data||saving)return;
    setSaving(true);setNotice('');
    try{await invoke({url:'/api/v1/studio/budget',method:'PUT',data:{token_limit:data.token_limit,prices:data.prices}});toast.success('预算已保存');await query.refresh();}
    catch{setNotice('预算暂未保存，填写的内容已保留，请稍后再试。');}
    finally{setSaving(false);}
  };
  if(!data)return <div className="mt-5 border-t pt-4 text-sm text-muted-foreground" role="status"><p>{query.waiting?'预算信息暂未同步，稍后会自动更新。':'正在同步月度预算…'}</p>{query.waiting&&<Button variant="ghost" size="sm" disabled={query.refreshing} onClick={()=>void query.refresh()}>刷新预算</Button>}</div>;
  return <section className="mt-5 rounded border p-4"><h3 className="font-semibold">月度预算 · {data.month}（UTC）</h3><p className="my-2 text-sm">本月实际用量 {data.used_tokens.toLocaleString()} tokens · 已配置单价部分估算 {data.estimated_cost.toFixed(4)} {data.unpriced_usage?'（有模型未配置价格）':''}</p>
    <fieldset disabled={saving}><label className="text-sm">Token 预算（0 为不限制）<Input type="number" min="0" value={data.token_limit} onChange={e=>setData({...data,token_limit:Number(e.target.value)})}/></label><p className="my-2 text-xs text-muted-foreground">达到预算后拒绝新的模型调用，已开始的调用可能使总量超过预算。涵盖生成、自动修复、报告及应用 AI。费用按你填写的每百万 tokens 单价估算，请统一币种；实际账单以供应商为准。</p>
    {['deepseek-flash','deepseek-v4-pro'].map(model=><div key={model} className="my-3"><p className="text-xs">{model}</p><div className="mt-1 flex gap-2">{(['input','output'] as const).map(k=><Input key={k} type="number" min="0" step="0.01" aria-label={model+(k==='input'?'输入单价':'输出单价')} placeholder={k==='input'?'输入单价 / 百万 tokens':'输出单价 / 百万 tokens'} value={data.prices[model]?.[k]??''} onChange={e=>setData({...data,prices:{...data.prices,[model]:{input:0,output:0,...data.prices[model],[k]:Number(e.target.value)}}})}/>)}</div></div>)}
    {query.waiting&&<p className="my-2 text-xs text-muted-foreground">当前显示最近同步的预算，稍后自动更新。</p>}
    {notice&&<p role="status" className="my-2 text-xs text-muted-foreground">{notice}</p>}
    <Button variant="outline" disabled={saving} onClick={()=>void save()}>{saving?'正在保存…':'保存预算'}</Button></fieldset>
  </section>;
}
