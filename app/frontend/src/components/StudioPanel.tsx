import StudioSelect from '@/components/StudioSelect';
import {useEffect,useState} from 'react';
import {Button} from '@/components/ui/button';
import {invoke,errorMessage} from '@/lib/sdk';
import {type AgentMode,type StudioRun} from '@/lib/studio';
import {useAgentTeam} from './AgentProvider';
import TeamBoard from './TeamBoard';
import AgentIntroduction from './AgentIntroduction';
import PreviewFrame from './PreviewFrame';
import {toast} from 'sonner';
import {runExperience} from '@/lib/runExperience';

export default function StudioPanel({run,onRun,onSaved,cloudSlug,agentMode='build'}:{run:StudioRun|null;onRun:(id:string)=>void;onSaved:()=>void;cloudSlug?:string|null;agentMode?:AgentMode}) {
  const agents=useAgentTeam(run?.agents);
  const [candidate,setCandidate]=useState(0);
  const [busy,setBusy]=useState(false);
  useEffect(()=>{setCandidate(0);},[run?.id]);
  if(!run)return <div className="mx-auto max-w-5xl space-y-5 p-4 sm:p-6"><TeamBoard run={null} mode={agentMode==='team'?'team':'build'}/><p className="text-xs text-muted-foreground">发送需求后，进展会在这里逐步点亮。点击阶段，可以提前了解工作内容与交付要求。</p></div>;
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
  return <div className="mx-auto w-full max-w-5xl space-y-5 p-4 text-sm sm:p-6">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-base font-semibold">工作看板</h2><p className="mt-1 text-xs text-muted-foreground">{run.mode==='team'?'团队模式':'工程师模式'} · 当前任务的计划、执行记录与生成结果</p></div><span className="rounded-full border bg-background px-3 py-1 text-xs">{labels[run.status]||run.status}</span></div>
    <TeamBoard run={run} mode={run.mode==='team'?'team':'build'}/>
    {experience.active&&<p className="mt-2" aria-live="polite">{experience.title} · {experience.description}</p>}
    <details className="rounded-xl border bg-background p-4"><summary className="cursor-pointer font-medium">执行日志（{run.events.length}）</summary>
      <div className="mt-4 space-y-3 text-xs">
      {run.events.filter(e=>e!==planEvent).map((e,i)=>{
        const person=agents[e.role||''];
        return <div key={i} className="flex gap-3 border-l-2 border-border pl-3">{person?<AgentIntroduction person={person} followParent><span className="w-20 shrink-0 text-muted-foreground">{person.title}</span></AgentIntroduction>:<span className="w-20 shrink-0 text-muted-foreground">{stages[e.stage]||e.stage}</span>}<span className="min-w-0 whitespace-pre-wrap break-words">{e.message}</span></div>;
      })}
      </div>
    </details>
    {run.result.summary&&<details className="rounded-xl border bg-background p-4"><summary className="cursor-pointer font-medium">交付摘要{run.result.version ? ` · v${run.result.version}` : ''}</summary><p className="mt-3 whitespace-pre-wrap text-sm text-muted-foreground">{run.result.summary}</p></details>}
    {run.error&&<section className="rounded-xl border bg-background p-4"><p className="font-medium">{experience.title}</p><p className="mt-2 text-muted-foreground">{experience.description}</p><details className="mt-3 text-xs"><summary className="cursor-pointer text-muted-foreground">查看诊断详情</summary><pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words">{run.error}</pre></details></section>}
    {['error','interrupted','cancelled'].includes(run.status)&&<Button size="sm" variant="outline" disabled={busy} className="mt-2" onClick={()=>void call('retry')}>{busy?'正在检查服务…':experience.resumeVerification?'继续验收':'继续任务'}</Button>}
    {run.status==='review'&&<div className="mt-3 space-y-2">
      <StudioSelect aria-label="候选版本" value={String(candidate)} onValueChange={value=>setCandidate(Number(value))} options={run.result.candidates?.map((c,i)=>({value:String(i),label:`${c.model} · 候选 ${i+1}`}))??[]}/>
      <p>{selected?.summary}</p>
      {selected&&<div className="h-72"><PreviewFrame files={selected.files} artifact={selected.artifact} cloudSlug={cloudSlug} storageKey={'candidate-'+run.id+'-'+candidate}/></div>}
      <Button size="sm" disabled={busy} onClick={()=>void call('choose',{index:candidate})}>采用这个版本</Button>
    </div>}
  </div>;
}
