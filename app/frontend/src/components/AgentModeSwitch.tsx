import {useStageTeam} from './AgentProvider';
import {Code2, Users} from 'lucide-react';
import {type AgentMode} from '@/lib/studio';

export function loadAgentMode(): AgentMode {
  try {return localStorage.getItem('atomforge.agentMode')==='team'?'team':'build';} catch {return 'build';}
}
export function saveAgentMode(mode:AgentMode) {
  try {localStorage.setItem('atomforge.agentMode',mode);} catch {/* Selection works without browser storage. */}
}

export default function AgentModeSwitch({value,onChange,disabled=false,compact=false}:{value:AgentMode;compact?:boolean;onChange:(mode:AgentMode)=>void;disabled?:boolean}) {
  const engineer=useStageTeam().find(r=>r.id==='engineer')?.alias||'工程师';
  return <div className="max-w-sm space-y-2">
    <div role="group" aria-label="智能体工作模式" className="inline-flex gap-1 rounded-lg border bg-muted/40 p-1">
      {([{id:'build',name:'工程师模式',Icon:Code2},{id:'team',name:'团队模式',Icon:Users}] as const).map(({id,name,Icon})=><button key={id} type="button" aria-pressed={value===id} disabled={disabled} onClick={()=>onChange(id)} className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium disabled:opacity-50 ${value===id?'bg-background text-primary shadow-sm':'text-muted-foreground hover:bg-background/60'}`}><Icon className="h-3.5 w-3.5"/>{name}</button>)}
    </div>
    {!compact&&<p className="text-xs leading-5 text-muted-foreground">{value==='team'?'领导统筹五位专业伙伴，必要决策由你确认。创建后模式固定。':`${engineer} 负责规划、实现和检查。创建后模式固定。`}</p>}

  </div>;
}
