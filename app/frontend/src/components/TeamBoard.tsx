import {Check, Loader2, Users} from 'lucide-react';
import {TEAM_ROLES, type StudioRun} from '@/lib/studio';
import AgentPersona from './AgentPersona';

export default function TeamBoard({run}:{run:StudioRun|null}) {
  const active = run && ['queued','running'].includes(run.status);
  return <section className="space-y-4" aria-label="智能体团队">
    <div><h3 className="flex items-center gap-2 font-semibold"><Users className="h-4 w-4"/>智能体团队</h3><p className="mt-1 text-xs leading-5 text-muted-foreground">需求 → 设计 → 架构 → 实现 → 独立验收。团队会自动处理可恢复的问题，通过验证后更新应用。</p></div>
    <div className="grid gap-3 xl:grid-cols-2">
      {TEAM_ROLES.map(role=>{
        const events = run?.events.filter(e=>e.role===role.id&&!e.kind?.startsWith('tool_')) || [];
        const latest = events.at(-1);
        const output = run?.result.team?.[role.id];
        const recovering=latest?.state==='recovering'&&active;
        const working = (latest?.state==='running'||recovering&&latest?.kind!=='handoff') && active;
        const done = (latest?.state==='done' || (!latest && Boolean(output))) && (role.id!=='qa'||output?.verified===true);
        const label = working?'工作中':recovering?'等待修复验证':latest?.state==='waiting'&&run?.status==='awaiting_input'?'等待你确认':done?'已交接':latest?.state==='error'?'待继续':latest?'已中断':active?'等待前序交接':'待开始';
        return <article key={role.id} className={`min-w-0 rounded-xl border bg-background p-4 ${working?'border-primary/60 ring-1 ring-primary/10':''}`}>
          <div className="flex items-center gap-2"><AgentPersona role={role.id} avatarClassName="h-10 w-10"/><div><h4 className="text-sm font-semibold">{role.alias} <span className="text-xs font-normal text-muted-foreground">{role.nickname}</span></h4><p className="text-[11px] text-muted-foreground">{role.name}</p></div><span className={`ml-auto flex items-center gap-1 text-xs ${working?'text-primary':'text-muted-foreground'}`}>{working?<Loader2 className="h-3 w-3 animate-spin"/>:done?<Check className="h-3 w-3"/>:null}{role.id==='qa'&&done?'验收通过':label}</span></div>
          <p className="mt-1 text-xs text-muted-foreground">{role.task}</p>
          {latest&&<p className="mt-3 line-clamp-3 break-words text-xs leading-5" aria-live={working?'polite':undefined}>{latest.state==='error'?'这一阶段尚未完成，已有进度保留。可在下方继续任务或查看诊断。':latest.message}</p>}
          {output&&<details className="mt-3 text-xs"><summary className="cursor-pointer text-primary">查看{role.id==='qa'?'验收报告':'交接产出'}</summary><div className="mt-3 space-y-2 break-words leading-5">
            <p>{output.summary||output.goal}</p>
            {(output.items||output.tasks||[]).map((item,i)=><p key={i}>{i+1}. {item}</p>)}
            {!!output.acceptance?.length&&<><p className="font-medium">验收标准</p>{output.acceptance.map((item,i)=><p key={i}>· {item}</p>)}</>}
            {!!output.issues?.length&&<><p className="font-medium text-destructive">需要修复</p>{output.issues.map((item,i)=><p key={i}>· {item}</p>)}</>}
            {output.tests&&<><p className="font-medium">独立浏览器测试 · {output.verified?'已执行通过':'尚未通过执行验证'}</p>{output.tests.map((test,i)=><p key={i} className="font-mono">{i+1}. {test.action} {test.selector} {test.value}</p>)}</>}
          </div></details>}
        </article>;
      })}
    </div>
  </section>;
}
