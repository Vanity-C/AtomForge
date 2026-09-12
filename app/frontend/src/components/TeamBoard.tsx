import {useState} from 'react';
import {ArrowRight, Check, ChevronDown, CircleDashed, Flag, Loader2, PackageCheck, RotateCcw, ShieldCheck, Workflow} from 'lucide-react';
import type {StudioRun} from '@/lib/studio';
import {pipelineStages, type PipelineState} from '@/lib/pipeline';
import {useTeam} from './AgentProvider';
import AgentAvatar from './AgentAvatar';
import AgentPersona from './AgentPersona';
import '@/styles/pipeline.css';

const labels:Record<PipelineState,string>={pending:'等待交接',active:'正在进行',complete:'已交接',waiting:'等待确认',blocked:'暂时停留'};
function StateIcon({state}:{state:PipelineState}){return state==='complete'?<Check/>:state==='active'?<Loader2 className="animate-spin"/>:<CircleDashed/>;}

export default function TeamBoard({run,mode='team'}:{run:StudioRun|null;mode?:'team'|'build'}) {
  const team=useTeam(run?.agents);
  const stages=pipelineStages(run,mode);
  const [selection,setSelection]=useState<{runId?:string;stage:string}|null>(null);
  const recommended=stages.find(s=>['active','waiting','blocked'].includes(s.state))||stages.find(s=>s.state==='pending')||stages[stages.length-1];
  const selected=(selection?.runId===run?.id&&stages.find(s=>s.id===selection?.stage))||recommended;
  const owner=team.find(r=>r.id===selected.role)!;
  const next=stages.find(s=>s.id===selected.next);
  const nextOwner=team.find(r=>r.id===next?.role);
  const gatekeeper=team.find(r=>r.id===selected.gatekeeper)||owner;
  const completed=stages.filter(s=>s.state==='complete').length;
  const delivered=run?.status==='done';
  const repairs=run?.events.filter(e=>e.stage==='repair'&&e.role==='engineer'&&e.state==='running'&&!e.kind?.startsWith('tool_')).length||0;
  const repairing=stages.some(s=>s.repairing);
  const stageLabel=(s:typeof selected)=>s.state==='complete'&&s.id==='qa'?'验收通过':s.state==='waiting'&&s.id==='qa'?'等待修复':labels[s.state];
  const output=selected.output;
  return <section className="pipeline-board" aria-label={mode==='team'?'团队协作流水线':'工程师工作流水线'}>
    {(run?.result.team?.leader||!run)&&<div className="pipeline-lead"><AgentAvatar role="leader" person={team.find(r=>r.id==='leader')?.profile} className="h-12 w-12"/><div><span>团队领导 · {team.find(r=>r.id==='leader')?.alias}</span><strong>{run?.result.team?.leader?.goal||'你说目标，我来安排团队。'}</strong><p>{run?.result.team?.leader?.summary||'由领导拆解阶段、分配任务，协调成员完成实现与独立验收。'}</p></div></div>}
    <header className="pipeline-heading"><span className="pipeline-heading-icon"><Workflow size={20}/></span><div><h3>{mode==='team'?'从想法，到交付':'一步步，把想法做出来'}</h3><p>{mode==='team'?'每一棒有人接，每一步有交代。':'从计划到验证，进展清晰可见。'}</p></div><div className="pipeline-count"><strong>{completed}<span> / {stages.length}</span></strong><small>阶段已完成</small></div></header>
    <div className="pipeline-track" style={{gridTemplateColumns:`repeat(${stages.length}, minmax(0, 1fr))`}}>
      {stages.map((stage,index)=>{
        const member=team.find(r=>r.id===stage.role)!;
        return <button key={stage.id} type="button" className={`pipeline-station is-${stage.state} ${selected.id===stage.id?'is-selected':''}`} aria-label={`${stage.title}，${member.alias}，${stageLabel(stage)}`} aria-pressed={selected.id===stage.id} aria-controls="pipeline-stage-detail" onClick={()=>setSelection({runId:run?.id,stage:stage.id})}>
          <span className="pipeline-portrait"><AgentAvatar role={stage.role} person={member.profile} className="pipeline-avatar"/><span className="pipeline-station-marker">{stage.state==='complete'?<Check size={11}/>:stage.state==='active'?<Loader2 size={11} className="animate-spin"/>:index+1}</span></span>
          <strong>{stage.title}</strong><span className="pipeline-member">{member.alias}</span><span className="pipeline-station-status">{stageLabel(stage)}</span>
        </button>;
      })}
    </div>
    <div className={`pipeline-return ${repairing?'is-repairing':''}`}><RotateCcw size={14}/><span>{repairing?'正在根据验收反馈修复，完成后会再次验证':repairs?`经过 ${repairs} 次修复${delivered?'，本轮已通过验收':'，继续推进本轮验证'}`:mode==='team'?'未通过验收 → 返回开发修复 → 再次验证':'自测发现问题 → 修复代码 → 重新验证'}</span><small>质量回路</small></div>
    <div className="pipeline-detail" id="pipeline-stage-detail" key={selected.id}>
      <div className="pipeline-detail-heading"><div><span className="pipeline-eyebrow">阶段 {String(stages.indexOf(selected)+1).padStart(2,'0')}</span><div className="pipeline-detail-title"><h4>{selected.title}</h4><span className={`pipeline-state is-${selected.state}`}>{stageLabel(selected)}</span></div><p>{selected.caption}</p></div><AgentPersona role={selected.role} profile={owner.profile} avatarClassName="h-14 w-14"/></div>
      <div className="pipeline-detail-columns"><div className="pipeline-work"><h5>这一棒，做什么</h5><ul>{selected.tasks.map(task=><li key={task}>{task}</li>)}</ul><div className="pipeline-owner"><span>负责伙伴</span><strong>{owner.alias}</strong><span>{owner.name}</span></div></div>
        <div className="pipeline-gate"><h5><ShieldCheck size={15}/>把关 · {gatekeeper.alias}</h5><p>{selected.gate}</p><div className="pipeline-delivery"><PackageCheck size={14}/><span>{selected.delivery}</span></div><div className="pipeline-next">{next&&nextOwner?<><AgentAvatar role={next.role} person={nextOwner.profile} className="h-6 w-6"/><span>交给 {nextOwner.alias}<small>{next.title}</small></span><ArrowRight size={15}/></>:<><Flag size={17}/><span>通过后保存版本<small>更新应用预览</small></span><ArrowRight size={15}/></>}</div></div>
      </div>
      <div className={`pipeline-progress-note is-${selected.state}`} aria-live={selected.state==='active'?'polite':undefined}><StateIcon state={selected.state}/><div><strong>{selected.state==='blocked'?'已有进度保留，可在下方继续任务':selected.state==='pending'?'等待前序伙伴交接':selected.state==='active'?`${owner.alias} 正在处理这一阶段`:selected.state==='waiting'?(selected.id==='qa'?'等待修复后重新验收':'等待你确认关键选择'):'这一阶段的产出已就绪'}</strong>{selected.last&&<p>{selected.last.message.startsWith('{')?'详细内容见下方交接文档。':selected.last.message}</p>}</div></div>
      {output&&<details className="pipeline-output"><summary><span>{selected.id==='qa'?'验收报告与测试记录':'实际交接文档'}</span><ChevronDown size={15}/></summary><div className="pipeline-output-body"><p>{output.summary||output.goal}</p>{!!(output.items||output.tasks)?.length&&<ul>{(output.items||output.tasks||[]).map((item,i)=><li key={i}>{item}</li>)}</ul>}{!!output.acceptance?.length&&<><h5>验收标准</h5><ul>{output.acceptance.map((item,i)=><li key={i}>{item}</li>)}</ul></>}{!!output.issues?.length&&<><h5>需要修复</h5><ul>{output.issues.map((item,i)=><li key={i}>{item}</li>)}</ul></>}{!!output.tests?.length&&<><h5>{selected.id==='qa'?`独立浏览器测试 · ${output.verified?'已执行通过':'尚未通过执行验证'}`:'开发自测步骤'}</h5><ol>{output.tests.map((test,i)=><li key={i}><code>{test.action} {test.selector} {test.value}</code></li>)}</ol></>}</div></details>}
    </div>
    {!!run?.result.team?.leader?.adjustments?.length&&<details className="pipeline-output"><summary>领导的调整记录 · {run.result.team.leader.adjustments.length} 次</summary><div className="pipeline-output-body">{run.result.team.leader.adjustments.map((adjustment,index)=><div key={index}><h5>第 {adjustment.attempt} 次修复安排</h5><p>{adjustment.summary}</p><ul>{adjustment.items.map((task,i)=><li key={i}>{task}</li>)}</ul></div>)}</div></details>}
    <footer className={`pipeline-finish ${delivered?'is-delivered':''}`}><Flag size={19}/><div><strong>{delivered?`${run.result.version?`v${run.result.version} `:''}已交付`:'下一站，可运行的作品'}</strong><p>{delivered?'本轮验证通过，最新作品已在预览中就绪。':'通过验证后保存正式版本，让每次交付都有依据。'}</p></div>{delivered&&<Check size={18}/>}</footer>
  </section>;
}
