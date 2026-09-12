import {useEffect,useState} from 'react';
import {Button} from '@/components/ui/button';
import {invoke,errorMessage} from '@/lib/sdk';
import {TEAM_ROLES,type AgentMode,type StudioRun} from '@/lib/studio';
import TeamBoard from './TeamBoard';
import PreviewFrame from './PreviewFrame';
import {toast} from 'sonner';
import {LayoutDashboard} from 'lucide-react';
import {runExperience} from '@/lib/runExperience';

export default function StudioPanel({run,onRun,onSaved,cloudSlug,agentMode='build'}:{run:StudioRun|null;onRun:(id:string)=>void;onSaved:()=>void;cloudSlug?:string|null;agentMode?:AgentMode}) {
  const [candidate,setCandidate]=useState(0);
  const [busy,setBusy]=useState(false);
  useEffect(()=>{setCandidate(0);},[run?.id]);
  if(!run&&agentMode==='team')return <div className="mx-auto max-w-5xl space-y-5 p-4 sm:p-6"><TeamBoard run={null}/><p className="text-sm text-muted-foreground">发送需求后，团队将依次开始工作。各角色使用当前选定模型，通过独立指令和交接产出协作。</p></div>;
  if(!run)return <div className="flex h-full min-h-64 flex-col items-center justify-center px-6 py-12 text-center">
    <div className="mb-4 rounded-xl border bg-background p-4"><LayoutDashboard className="h-6 w-6 text-muted-foreground" /></div>
    <h2 className="text-base font-semibold">工作看板</h2>
    <p className="mt-2 text-sm text-muted-foreground">还没有任务执行记录</p>
    <p className="mt-2 max-w-sm text-xs leading-6 text-muted-foreground">发送新的需求后，在这里查看任务计划、构建与测试日志，以及模型生成的候选版本。</p>
  </div>;
  const labels:Record<string,string>={queued:'等待执行',running:'执行中',awaiting_input:'等待你确认',done:'已完成',review:'请选择候选',error:'执行失败',cancelled:'已停止',interrupted:'服务重启后中断'};
  const call=async(action:string,data?:Record<string,unknown>)=>{
    setBusy(true);
    try {
      const r=await invoke<{id?:string}>({url:`/api/v1/studio/runs/${run.id}/${action}`,method:'POST',data});
      if(r.id)onRun(r.id);else onSaved();
    }catch(e){toast.error(errorMessage(e));}finally{setBusy(false);}
  };
  const selected=run.result.candidates?.[candidate];
  const experience=runExperience(run);
  const stages:Record<string,string>={plan:'规划',code:'编码',build:'构建',test:'测试',repair:'修复',save:'保存',error:'检查未通过',review:'待选择'};
  const planEvent=run.events.find(e=>e.stage==='plan'&&e.message.startsWith('{'));
  let plan:{tasks?:string[]}={};try{plan=JSON.parse(planEvent?.message||'{}');}catch{/* keep the original log */}
  return <div className="mx-auto w-full max-w-5xl space-y-5 p-4 text-sm sm:p-6">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-base font-semibold">工作看板</h2><p className="mt-1 text-xs text-muted-foreground">{run.mode==='team'?'团队模式':'工程师模式'} · 当前任务的计划、执行记录与生成结果</p></div><span className="rounded-full border bg-background px-3 py-1 text-xs">{labels[run.status]||run.status}</span></div>
    {run.mode==='team'?<TeamBoard run={run}/>:agentMode==='team'?<><p className="text-xs text-muted-foreground">团队已就绪，将从下一条需求开始协作。下方日志属于上一项工程师任务。</p><TeamBoard run={null}/></>:null}
    {experience.active&&<p className="mt-2" aria-live="polite">{experience.title} · {experience.description}</p>}
    {Boolean(plan.tasks?.length)&&<section className="rounded-xl border bg-background p-4"><h3 className="mb-3 font-medium">任务计划</h3><ol className="space-y-2 text-sm">{plan.tasks?.map((task,i)=><li className="flex gap-3" key={i}><span className="text-muted-foreground">{i+1}.</span><span className="min-w-0 break-words">{task}</span></li>)}</ol></section>}
    <details className="rounded-xl border bg-background p-4"><summary className="cursor-pointer font-medium">执行日志（{run.events.length}）</summary>
      <div className="mt-4 space-y-3 text-xs">
      {run.events.filter(e=>e!==planEvent).map((e,i)=><div key={i} className="flex gap-3 border-l-2 border-border pl-3"><span className="w-20 shrink-0 text-muted-foreground">{TEAM_ROLES.find(role=>role.id===e.role)?.name||stages[e.stage]||e.stage}</span><span className="min-w-0 whitespace-pre-wrap break-words">{e.message}</span></div>)}
      </div>
    </details>
    {run.result.summary&&<section className="rounded-xl border bg-background p-4"><h3 className="mb-2 font-medium">生成结果{run.result.version ? ` · v${run.result.version}` : ''}</h3><p className="whitespace-pre-wrap text-sm text-muted-foreground">{run.result.summary}</p></section>}
    {run.error&&<section className="rounded-xl border bg-background p-4"><p className="font-medium">{experience.title}</p><p className="mt-2 text-muted-foreground">{experience.description}</p><details className="mt-3 text-xs"><summary className="cursor-pointer text-muted-foreground">查看诊断详情</summary><pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words">{run.error}</pre></details></section>}
    {['error','interrupted','cancelled'].includes(run.status)&&<Button size="sm" variant="outline" disabled={busy} className="mt-2" onClick={()=>void call('retry')}>重新执行</Button>}
    {run.status==='review'&&<div className="mt-3 space-y-2">
      <select className="w-full rounded border bg-background p-2" value={candidate} onChange={e=>setCandidate(Number(e.target.value))}>{run.result.candidates?.map((c,i)=><option key={c.model} value={i}>{c.model} · 候选 {i+1}</option>)}</select>
      <p>{selected?.summary}</p>
      {selected&&<div className="h-72"><PreviewFrame files={selected.files} artifact={selected.artifact} cloudSlug={cloudSlug} storageKey={'candidate-'+run.id+'-'+candidate}/></div>}
      <Button size="sm" disabled={busy} onClick={()=>void call('choose',{index:candidate})}>采用这个版本</Button>
    </div>}
  </div>;
}
