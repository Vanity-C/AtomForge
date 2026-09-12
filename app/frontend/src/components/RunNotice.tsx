import {useEffect,useState} from 'react';
import {CheckCircle2,Loader2,PauseCircle} from 'lucide-react';
import type {StudioRun} from '@/lib/studio';
import {runExperience} from '@/lib/runExperience';

export default function RunNotice({run,onOpenBoard}:{run:StudioRun|null;onOpenBoard:()=>void}){
  const [now,setNow]=useState(Date.now);
  const active=!!run&&['queued','running'].includes(run.status);
  useEffect(()=>{if(!active)return;const timer=setInterval(()=>setNow(Date.now()),5000);return()=>clearInterval(timer);},[active]);
  if(!run)return null;
  const view=runExperience(run);
  const last=Date.parse(run.events.at(-1)?.at??'');
  const elapsed=Number.isFinite(last)?Math.max(0,Math.floor((now-last)/1000)):0;
  return <div className="shrink-0 border-b bg-muted/30 px-3 py-2.5 text-xs" aria-label="当前任务状态">
    <div className="flex items-center gap-2" role="status">{view.active?<Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-primary"/>:run.status==='done'?<CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-600"/>:<PauseCircle className="h-3.5 w-3.5 shrink-0 text-muted-foreground"/>}<span className="font-medium">{view.title}</span></div>
    <p className="mt-1 leading-5 text-muted-foreground">{view.description}</p>
    {active&&elapsed>=20&&<p className="mt-1 text-[11px] text-muted-foreground">当前步骤已等待 {elapsed} 秒，正在等待执行结果。</p>}
    <button type="button" onClick={onOpenBoard} className="mt-1 rounded text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{['error','interrupted','cancelled'].includes(run.status)?'查看进度并继续':'查看任务详情'}</button>
  </div>;
}
