import {useState} from 'react';
import {Flag, Gauge, Layers3, ShieldCheck, Timer, AlertTriangle} from 'lucide-react';
import {toast} from 'sonner';
import {invoke,errorMessage} from '@/lib/sdk';
import type {StudioRun,DeliveryWorkflow,StrategyPolicy} from '@/lib/studio';
import {useStageTeam} from './AgentProvider';
import AgentPersona from './AgentPersona';
import {Button} from './ui/button';
import {Input} from './ui/input';
import {Label} from './ui/label';
import '@/styles/delivery-board.css';

const minutes=(seconds:number|null)=>seconds===null?'暂无记录':seconds<60?`${Math.round(seconds)} 秒`:`${(seconds/60).toFixed(1)} 分钟`;
function StrategyEditor({run,board}:{run:StudioRun;board:DeliveryWorkflow}){
  const [policy,setPolicy]=useState<StrategyPolicy>(board.policy);
  const [reason,setReason]=useState('');const [busy,setBusy]=useState(false);const [error,setError]=useState('');
  const [saved,setSaved]=useState(false);
  const terminal=!['queued','running','awaiting_input'].includes(run.status);
  async function save(event:React.FormEvent){
    event.preventDefault();setBusy(true);setError('');
    try{await invoke({url:`/api/v1/studio/runs/${run.id}/strategy`,method:'PATCH',data:{...policy,revision:board.revision,reason:reason.trim()}});setSaved(true);toast.success('战略策略已保存，后续门禁按新策略执行');}
    catch(e){setError(errorMessage(e));}finally{setBusy(false);}
  }
  return <form className="delivery-strategy-form" onSubmit={save}>
    <div className="delivery-strategy-fields">
      <div><Label htmlFor="strategy-priority">优先级 / 泳道</Label><select id="strategy-priority" value={policy.priority} disabled={terminal||busy} onChange={e=>setPolicy({...policy,priority:e.target.value})}><option value="urgent">紧急 · 加急泳道</option><option value="normal">普通 · 标准泳道</option><option value="low">低 · 标准泳道</option></select></div>
      {([{key:'wip',label:'进行中 WIP 上限',max:3,min:1},{key:'sla_minutes',label:'工作包 SLA（分钟）',max:1440,min:1},{key:'max_repairs',label:'自动修复上限',max:2,min:0},{key:'min_tests',label:'独立测试最少步骤',max:16,min:2}] as const).map(field=><div key={field.key}><Label htmlFor={'strategy-'+field.key}>{field.label}</Label><Input id={'strategy-'+field.key} type="number" min={field.min} max={field.max} required disabled={terminal||busy} value={policy[field.key]} onChange={e=>setPolicy({...policy,[field.key]:Number(e.target.value)})}/></div>)}
    </div>
    <p className="delivery-help">当前执行器每次执行一个专业工作包；提高 WIP 不会自动增加模型并发。成员快照本轮固定，更换团队在下次任务生效。SLA 超时标记提醒，不自动跳过门禁。</p>
    <Label htmlFor="strategy-reason">调整原因</Label><Input id="strategy-reason" value={reason} onChange={e=>setReason(e.target.value)} maxLength={500} disabled={terminal||busy} placeholder="记录优先级、质量或等待成本的具体依据" required/>
    {error&&<p role="alert" className="text-sm text-destructive">{error}</p>}
    <Button type="submit" disabled={terminal||busy||saved||!reason.trim()}>{terminal?'本轮策略已归档':busy?'正在保存…':saved?'策略已保存':'保存战略调整'}</Button>
  </form>;
}

export default function DeliveryBoard({run}:{run:StudioRun}){
  const board=run.result.workflow!;const team=useStageTeam(run.agents);
  const [view,setView]=useState<'delivery'|'strategy'>('delivery');
  const [selected,setSelected]=useState<string|null>(null);
  const card=board.cards.find(c=>c.id===selected)||board.cards.find(c=>c.blocked||['doing','review','verifying','acceptance'].includes(c.state))||board.cards[0];
  const column=board.columns.find(c=>c.id===card?.state);
  const leader=team.find(m=>m.id==='leader');
  return <section className="delivery-board" aria-label="团队双层看板">
    <header className="delivery-heading"><div className="flex items-center gap-3">{leader&&<AgentPersona role="leader" profile={leader.profile} avatarClassName="h-12 w-12"/>}<div><span className="delivery-kicker">TEAM DELIVERY · {board.version}</span><h3>专业直达，协作有序</h3><p>{run.result.team?.leader?.goal||'固定交付流程，按证据推进。'}</p></div></div><span className="delivery-version">策略 r{board.revision}</span></header>
    <div className="delivery-tabs" role="group" aria-label="选择看板"><button aria-pressed={view==='delivery'} onClick={()=>setView('delivery')}><Layers3 size={16}/>交付看板</button><button aria-pressed={view==='strategy'} onClick={()=>setView('strategy')}><Gauge size={16}/>领导战略看板</button></div>
    {view==='strategy'?<div className="delivery-strategy"><h4>管理策略，不逐站审批</h4><p>领导处理目标、优先级、容量、等待与异常升级。日常交接由专业负责人直接完成；独立测试不可关闭。</p><StrategyEditor key={run.id+':'+board.revision} run={run} board={board}/><details><summary>策略变更记录 · {board.policy_history.length}</summary>{board.policy_history.map(entry=><p key={entry.revision}>r{entry.revision} · {entry.reason}</p>)}</details></div>:<>
      <div className="delivery-metrics"><span><Flag size={15}/><strong>{board.metrics.completed_packages}/{board.cards.length}</strong>工作包完成</span><span><Timer size={15}/><strong>{minutes(board.metrics.elapsed_seconds)}</strong>本轮经过</span><span><Gauge size={15}/><strong>{board.metrics.rework_count}</strong>开发返工</span></div>
      <p className="delivery-help">{board.policy.priority==='urgent'?'加急':'标准'}泳道 · 进行中 WIP {board.cards.filter(c=>c.state==='doing').length}/{board.policy.wip} · 阻塞留在原列 · 首次修复直接返回工程师</p>
      <div className="delivery-columns">{board.columns.map(col=><section key={col.id} className="delivery-column" aria-label={col.name}><h4>{col.name}<span>{board.cards.filter(c=>c.state===col.id).length}</span></h4>{board.cards.filter(c=>c.state===col.id).map(item=><button key={item.id} className={`delivery-card ${item.id===card?.id?'is-selected':''}`} aria-pressed={item.id===card?.id} onClick={()=>setSelected(item.id)}><span className="delivery-card-id">{item.id.slice(0,6)} · {item.role}</span><strong>{item.title}</strong><span>{item.owner_name} · 唯一负责人</span><small>{item.tasks.length} 项检查 · {item.lane}</small>{(item.blocked||item.overdue)&&<em><AlertTriangle size={12}/>{item.blocked||'SLA 超时'}</em>}</button>)}</section>)}</div>
      {card&&<div className="delivery-detail"><div className="flex items-center justify-between gap-3"><div><span className="delivery-kicker">{card.id}</span><h4>{card.title}</h4><p>{card.owner_name} 负责 · 周期 {minutes(card.cycle_seconds)}</p></div>{team.find(m=>m.id===card.role)&&<AgentPersona role={card.role} profile={team.find(m=>m.id===card.role)!.profile} avatarClassName="h-12 w-12"/>}</div><div className="delivery-detail-grid"><div><h5>工作包检查项</h5><ul>{card.tasks.map((task,i)=><li key={i}>{task}</li>)}</ul><h5>验收标准</h5>{card.acceptance.length?<ul>{card.acceptance.map((criterion,i)=><li key={i}>{criterion}</li>)}</ul>:<p>由产品工作包补齐，后续阶段继承。</p>}<h5>协作者</h5><p>{card.collaborators.map(id=>Object.values(run.agents||{}).find(person=>person.id===id)?.name||id).join("、")||"无额外协作者"}</p><h5>输出物</h5><p>{card.output}</p><h5>依赖卡片</h5><p>{card.depends_on.join('、')||'无前序依赖'}</p></div><div><h5><ShieldCheck size={14}/>当前门禁 · {card.gate}</h5><p><b>准入：</b>{column?.entry}</p><p><b>准出：</b>{column?.exit}</p><p><b>下一状态：</b>{column?.next.map(id=>board.columns.find(c=>c.id===id)?.name).join(' / ')||'新需求另开任务'}</p><p><b>实际证据：</b>{card.evidence||'尚未产生'}</p></div></div>{card.blocked&&<p className="delivery-blocked">阻塞：{card.blocked} · 已记录等待 {minutes(card.blocked_seconds)}</p>}</div>}
      <p className="delivery-help">卡片覆盖本轮工作包及其检查项；文档门禁是结构校验，不能代替真实测试。吞吐量与缺陷逃逸率需按发布批次汇总，当前不展示估算值。</p>
    </>}
  </section>;
}
