import {useEffect,useRef,useState} from 'react';
import {Check,Clock3,Loader2,Pause} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Textarea} from '@/components/ui/textarea';
import {agentLabel,type PendingConfirmation} from '@/lib/studio';
import {invoke,errorMessage} from '@/lib/sdk';
import AgentPersona from './AgentPersona';

type Draft={selections:Record<string,string>;other:Record<string,string>;feedback:string};
export default function ConfirmationCard({runId,pending,serverTime,canEdit,onUpdated}:{runId:string;pending:PendingConfirmation;serverTime?:number;canEdit:boolean;onUpdated:()=>void}) {
  const cacheKey=`atomforge.confirmation.${runId}.${pending.id}`;
  const [draft,setDraft]=useState<Draft>(()=>{
    const defaults={selections:Object.fromEntries(pending.choices.map(q=>[q.id,q.recommended])),other:{},feedback:''};
    try {const saved=JSON.parse(localStorage.getItem(cacheKey)||'null');return saved?.selections&&saved?.other&&typeof saved.feedback==='string'?saved:defaults;} catch{return defaults;}
  });
  const [auto,setAuto]=useState(pending.auto);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [now,setNow]=useState(Date.now());
  const controlTime=useRef(0);
  const offset=useRef((serverTime||Date.now()/1000)*1000-Date.now());
  const requestBusy=useRef(false);
  useEffect(()=>{
    if((serverTime||0)>=controlTime.current){setAuto(pending.auto);offset.current=(serverTime||Date.now()/1000)*1000-Date.now();}
  },[pending.auto,serverTime]);
  useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),250);return()=>clearInterval(timer);},[]);
  useEffect(()=>{try{localStorage.setItem(cacheKey,JSON.stringify(draft));}catch{/* Draft remains available for this visit. */}},[cacheKey,draft]);
  const remaining=Math.max(0,Math.ceil(((auto.deadline||0)*1000-now-offset.current)/1000));
  const control=async(action:'pause'|'resume')=>{
    if(!canEdit||requestBusy.current)return false;
    requestBusy.current=true;setBusy(true);setError('');
    if(action==='pause')setAuto(previous=>({...previous,paused:true}));
    try{
      const result=await invoke<{pending:PendingConfirmation;server_time:number}>({url:`/api/v1/studio/runs/${runId}/decision-control`,method:'POST',data:{checkpoint_id:pending.id,action}});
      controlTime.current=result.server_time;offset.current=result.server_time*1000-Date.now();setAuto(result.pending.auto);setNow(Date.now());
      if(action==='resume')setDraft({selections:Object.fromEntries(pending.choices.map(q=>[q.id,q.recommended])),other:{},feedback:''});
      onUpdated();return true;
    }catch(e){setError(errorMessage(e));setAuto(pending.auto);onUpdated();return false;}finally{requestBusy.current=false;setBusy(false);}
  };
  const select=async(questionId:string,optionId:string)=>{
    if(!auto.paused&&!await control('pause'))return;
    setDraft(previous=>({...previous,selections:{...previous.selections,[questionId]:optionId}}));
  };
  const submit=async()=>{
    if(requestBusy.current)return;
    requestBusy.current=true;setBusy(true);setError('');
    try{
      await invoke({url:`/api/v1/studio/runs/${runId}/decision`,method:'POST',data:{checkpoint_id:pending.id,action:'approve',...draft}});
      try{localStorage.removeItem(cacheKey);}catch{/* No persisted draft to clean up. */}
      onUpdated();
    }catch(e){setError(errorMessage(e));onUpdated();}finally{requestBusy.current=false;setBusy(false);}
  };
  const custom=pending.choices.some(q=>draft.selections[q.id]==='other')||!!draft.feedback.trim();
  const valid=pending.choices.every(q=>draft.selections[q.id]&&(draft.selections[q.id]!=='other'||draft.other[q.id]?.trim()));
  return <section aria-label="关键细节确认" className="space-y-4 rounded-xl border border-primary/30 bg-primary/[0.03] p-3">
    <h3 className="flex items-center gap-2 text-sm font-semibold"><AgentPersona role="product" avatarClassName="h-8 w-8"/>Milo 请你确认：{pending.title}</h3>
    <div className="sticky top-0 z-10 space-y-2 rounded-lg border bg-background p-3 text-xs shadow-sm">
      <p role="status" className="flex items-center gap-2 font-medium">{auto.paused?<Pause className="h-3.5 w-3.5"/>:<Clock3 className="h-3.5 w-3.5"/>}{auto.paused?'已暂停计时，等你决定':remaining>0?`${remaining} 秒后自动采用推荐项`:'正在采用推荐项，请稍候…'}</p>
      <p className="leading-5 text-muted-foreground">推荐项结合当前需求选出。选择其他方案或填写想法会暂停计时；刷新后保留计时状态。</p>
      {!auto.paused&&<><div className="h-1 overflow-hidden rounded-full bg-muted"><div className="h-full bg-primary transition-all" style={{width:`${Math.min(100,remaining/30*100)}%`}}/></div><Button variant="outline" size="sm" className="w-full" disabled={!canEdit||busy} onClick={()=>void control('pause')}><Pause className="mr-1 h-3 w-3"/>让我继续思考一下</Button></>}
      {auto.error&&<p className="text-destructive">{auto.error}</p>}
    </div>
    <details className="text-xs"><summary className="cursor-pointer font-medium">查看完整方案与验收标准</summary><div className="mt-3 space-y-3">{Object.entries(pending.documents).map(([key,doc])=><div key={key}><p className="font-medium">{agentLabel(key)}</p><p className="mt-1 leading-5">{doc.goal||doc.summary}</p>{(doc.tasks||doc.items||[]).map((line,i)=><p key={i} className="mt-1 leading-5">{i+1}. {line}</p>)}{doc.acceptance?.map((line,i)=><p key={i} className="mt-1 leading-5">验收：{line}</p>)}</div>)}</div></details>
    {pending.choices.map((question,index)=><fieldset key={question.id} disabled={!canEdit||busy} className="min-w-0 space-y-2">
      <legend className="mb-2 text-xs font-semibold leading-5">{index+1}. {question.question}</legend>
      {question.options.map(option=><label key={option.id} className={`flex cursor-pointer items-start gap-2 rounded-lg border p-2.5 text-xs transition-colors ${draft.selections[question.id]===option.id?'border-primary/60 bg-primary/5':'border-border bg-background hover:border-primary/30'}`}>
        <input type="radio" name={`${pending.id}-${question.id}`} checked={draft.selections[question.id]===option.id} onChange={()=>void select(question.id,option.id)} className="mt-0.5 accent-primary"/>
        <span className="min-w-0"><span className="font-medium">{option.label}</span>{question.recommended===option.id&&<span className="ml-1.5 rounded bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary">推荐</span>}<span className="mt-1 block leading-5 text-muted-foreground">{option.description}</span></span>
      </label>)}
      <label className={`flex cursor-pointer items-center gap-2 rounded-lg border p-2.5 text-xs ${draft.selections[question.id]==='other'?'border-primary/60 bg-primary/5':'bg-background'}`}><input type="radio" name={`${pending.id}-${question.id}`} checked={draft.selections[question.id]==='other'} onChange={()=>void select(question.id,'other')} className="accent-primary"/>其他，我有自己的想法</label>
      {draft.selections[question.id]==='other'&&<Textarea aria-label={`其他想法：${question.question}`} placeholder="写下你希望采用的方式…" maxLength={1500} value={draft.other[question.id]||''} onChange={e=>setDraft(previous=>({...previous,other:{...previous.other,[question.id]:e.target.value}}))} className="min-h-20 text-xs"/>}
      <p className="text-[11px] leading-5 text-muted-foreground">推荐理由：{question.reason}</p>
    </fieldset>)}
    <Textarea aria-label="确认反馈" placeholder="补充想法（可选，输入时暂停计时）…" maxLength={1500} value={draft.feedback} onFocus={()=>{if(!auto.paused)void control('pause');}} onChange={e=>setDraft(previous=>({...previous,feedback:e.target.value}))} disabled={!canEdit||busy} className="min-h-16 text-xs"/>
    {error&&<p role="alert" className="text-xs text-destructive">{error}</p>}
    <Button size="sm" className="w-full" disabled={!canEdit||busy||!valid||(!auto.paused&&remaining===0)} onClick={()=>void submit()}>{busy?<Loader2 className="mr-1 h-3 w-3 animate-spin"/>:<Check className="mr-1 h-3 w-3"/>}{custom?'提交想法，更新方案':'确认选择并继续'}</Button>
    {auto.paused&&!custom&&<Button variant="ghost" size="sm" className="w-full text-xs" disabled={!canEdit||busy} onClick={()=>void control('resume')}>重新计时 30 秒，使用推荐项</Button>}
  </section>;
}
