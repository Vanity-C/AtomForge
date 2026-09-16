import StudioSelect from '@/components/StudioSelect';
import {useEffect,useRef,useState} from 'react';
import {CircleAlert,Loader2,PauseCircle,RotateCcw} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {invoke,errorMessage} from '@/lib/sdk';
import {type AgentMode,type StudioRun} from '@/lib/studio';
import TeamBoard from './TeamBoard';
import RunLog from './RunLog';
import PreviewFrame from './PreviewFrame';
import {toast} from 'sonner';
import {runExperience} from '@/lib/runExperience';

export default function StudioPanel({run,onRun,onSaved,cloudSlug,agentMode='build'}:{run:StudioRun|null;onRun:(id:string)=>void;onSaved:()=>void;cloudSlug?:string|null;agentMode?:AgentMode}) {
  const [candidate,setCandidate]=useState(0);
  const [busy,setBusy]=useState(false);
  const actionLock=useRef(false);
  useEffect(()=>{setCandidate(0);},[run?.id]);
  if(!run)return <div className="mx-auto max-w-5xl space-y-5 p-4 sm:p-6"><TeamBoard run={null} mode={agentMode==='team'?'team':'build'}/><p className="text-xs text-muted-foreground">发送需求后，进展会在这里逐步点亮。点击阶段，可以提前了解工作内容与交付要求。</p></div>;
  const labels:Record<string,string>={queued:'等待执行',running:'执行中',awaiting_input:'等待你确认',done:'已完成',review:'请选择候选',error:'执行失败',cancelled:'已停止',interrupted:'服务重启后中断'};
  const call=async(action:string,data?:Record<string,unknown>)=>{
    if(actionLock.current)return;
    actionLock.current=true;
    setBusy(true);
    try {
      const r=await invoke<{id?:string}>({url:`/api/v1/studio/runs/${run.id}/${action}`,method:'POST',data});
      if(r.id)onRun(r.id);else onSaved();
    }catch(e){toast.error(errorMessage(e));}finally{actionLock.current=false;setBusy(false);}
  };
  const selected=run.result.candidates?.[candidate];
  const experience=runExperience(run);
  const recoverable=['error','interrupted','cancelled'].includes(run.status);
  return <div className="mx-auto w-full max-w-5xl space-y-5 p-4 text-sm sm:p-6">
    <section className={recoverable?'sticky top-2 z-10 rounded-2xl border bg-background p-4 shadow-sm sm:p-5':''} aria-label="任务状态与操作">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div><h2 className="text-base font-semibold">工作看板</h2><p className="mt-1 text-xs text-muted-foreground">{run.mode==='team'?'团队模式':'工程师模式'} · {recoverable?'查看进度，从保留的成果继续':'当前任务的计划、执行记录与生成结果'}</p></div>
        <div className="flex shrink-0 items-center gap-3">
          <span className={recoverable?'inline-flex items-center gap-1.5 rounded-full bg-amber-500/10 px-3 py-1.5 text-xs font-medium text-amber-800 dark:text-amber-300':'rounded-full border bg-background px-3 py-1 text-xs'}>
            {recoverable&&(run.status==='error'?<CircleAlert size={14} aria-hidden="true"/>:<PauseCircle size={14} aria-hidden="true"/>)}{labels[run.status]||run.status}
          </span>
          {recoverable&&<Button size="sm" disabled={busy} aria-busy={busy} className="gap-2 rounded-lg px-4 shadow-sm" onClick={()=>void call('retry')}>
            {busy?<Loader2 size={14} className="animate-spin" aria-hidden="true"/>:<RotateCcw size={14} aria-hidden="true"/>}{busy?'正在恢复…':experience.resumeVerification?'继续验收':'继续任务'}
          </Button>}
        </div>
      </div>
      {recoverable&&<div className="mt-4 border-t border-border/70 pt-3">
        <p className="text-xs leading-6 text-muted-foreground" role="status">{experience.description}</p>
        {run.error&&<details key={run.id} className="mt-1 text-xs"><summary className="w-fit cursor-pointer rounded py-1 font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">查看诊断详情</summary><pre className="mt-2 max-h-36 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-muted/50 p-3 text-xs leading-6 text-muted-foreground">{run.error}</pre></details>}
      </div>}
    </section>
    <TeamBoard run={run} mode={run.mode==='team'?'team':'build'}/>
    {experience.active&&<p className="mt-2" aria-live="polite">{experience.title} · {experience.description}</p>}
    <RunLog key={run.id} run={run}/>
    {run.result.summary&&<details className="rounded-xl border bg-background p-4"><summary className="cursor-pointer font-medium">交付摘要{run.result.version ? ` · v${run.result.version}` : ''}</summary><p className="mt-3 whitespace-pre-wrap text-sm text-muted-foreground">{run.result.summary}</p></details>}
    {run.error&&!recoverable&&<details className="rounded-xl border bg-background p-4 text-xs"><summary className="cursor-pointer text-muted-foreground">查看诊断详情</summary><pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words">{run.error}</pre></details>}
    {run.status==='review'&&<div className="mt-3 space-y-2">
      <StudioSelect aria-label="候选版本" value={String(candidate)} onValueChange={value=>setCandidate(Number(value))} options={run.result.candidates?.map((c,i)=>({value:String(i),label:`${c.model} · 候选 ${i+1}`}))??[]}/>
      <p>{selected?.summary}</p>
      {selected&&<div className="h-72"><PreviewFrame files={selected.files} artifact={selected.artifact} cloudSlug={cloudSlug} storageKey={'candidate-'+run.id+'-'+candidate}/></div>}
      <Button size="sm" disabled={busy} onClick={()=>void call('choose',{index:candidate})}>采用这个版本</Button>
    </div>}
  </div>;
}
