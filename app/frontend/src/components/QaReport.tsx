import {useState} from 'react';
import type {QaIssue,TeamOutput} from '@/lib/studio';
import {issueTypes,issueSeverities,issueSources,severityOrder,reportIssues} from '@/lib/qaIssues';

/** Keep isolated scenario boundaries and genuine execution status visible. */
export default function QaReport({output,historical=false}:{output:TeamOutput;historical?:boolean}) {
  const report=output.verification;
  const issues=reportIssues(output);
  const pending=report?.pendingIssues??[];
  const advisories=report?.advisories??output.advisories??[];
  const [severity,setSeverity]=useState<QaIssue['severity']|'all'>('all');
  const [type,setType]=useState<QaIssue['type']|'all'>('all');
  const visible=issues.map((issue,index)=>({...issue,index})).filter(issue=>(severity==='all'||issue.severity===severity)&&(type==='all'||issue.type===type))
    .sort((a,b)=>severityOrder.indexOf(a.severity)-severityOrder.indexOf(b.severity));
  const scenarios=output.scenarios?.length ? output.scenarios
    : output.tests?.length ? [{name:'独立验收',tests:output.tests}] : [];
  const statusLabels={passed:'通过',failed:'失败',blocked:'阻塞 · 未执行'};
  return <section className="mt-4 space-y-3 rounded-lg border p-4 text-sm" aria-label="集中验收报告">
    <h5 className="font-semibold">测试问题看板</h5>
    <p>{historical?'这是当时记录的修复反馈，不代表这些问题当前仍然存在。':output.verified ? '源码审查与全部必需测试已通过。'
      : pending.length ? '检查记录由 QA 核实中，尚未作为开发返工要求。'
      : report?.complete ? '本轮检查已完成，问题汇总后统一反馈。'
      : '本轮验收尚未完成；未执行的场景不会计为通过。'}</p>
    {output.summary&&<p className="text-muted-foreground">{historical?'反馈摘要':'源码审查'}：{output.summary}</p>}
    {report?.selfTest&&<p>构建与开发自测：{report.selfTest.ok?'通过':'未通过'}{report.selfTest.error&&` · ${report.selfTest.error}`}</p>}
    {!!issues.length&&<div className="space-y-3">
      <h5 className="font-medium">{report?.triageComplete===true?'确认需修复':'集中反馈'} · {issues.length} 项</h5>
      <div className="flex flex-wrap gap-2" role="group" aria-label="按严重等级筛选">
        <button type="button" aria-pressed={severity==='all'} className={`rounded-md border px-3 py-2 text-xs ${severity==='all'?'bg-primary text-primary-foreground':''}`} onClick={()=>setSeverity('all')}>全部 {issues.length}</button>
        {severityOrder.map(level=><button key={level} type="button" aria-pressed={severity===level} className={`rounded-md border px-3 py-2 text-xs ${severity===level?'bg-primary text-primary-foreground':''}`} onClick={()=>setSeverity(level)}>{issueSeverities[level]} {issues.filter(issue=>issue.severity===level).length}</button>)}
      </div>
      <label className="flex flex-wrap items-center gap-2 text-xs">问题类型<select aria-label="问题类型" value={type} onChange={event=>setType(event.target.value as typeof type)} className="rounded-md border bg-background p-2"><option value="all">全部类型</option>{Object.entries(issueTypes).map(([value,label])=><option value={value} key={value}>{label}</option>)}</select><span className="text-muted-foreground">显示 {visible.length} / {issues.length} 项</span></label>
      {issues.some(issue=>issue.severity==='unknown'||issue.type==='unknown')&&<p className="text-xs text-muted-foreground">未标注表示原报告或执行器未提供分类依据，不代表没有问题或问题轻微。</p>}
      {!visible.length&&<p className="text-sm text-muted-foreground">此筛选条件下暂无问题。</p>}
      <div className="space-y-3">{visible.map(issue=><article key={issue.index} aria-label={`问题 ${issue.index+1}`} className="min-w-0 space-y-2 rounded-lg border bg-muted/20 p-3">
        <div className="flex flex-wrap items-center gap-2 text-xs"><strong>#{String(issue.index+1).padStart(2,'0')}</strong><span className={`rounded border px-2 py-1 ${['critical','high'].includes(issue.severity)?'border-destructive/30 bg-destructive/10 text-destructive':'bg-background'}`}>{issueSeverities[issue.severity]||'等级未标注'}</span><span className="rounded border bg-background px-2 py-1">{issueTypes[issue.type]||'类型未标注'}</span><span className="text-muted-foreground">{issueSources[issue.source||'legacy']||'测试报告'}{issue.scenario&&` · ${issue.scenario}`}</span></div>
        <p className="whitespace-pre-wrap break-words font-medium">{issue.description}</p>
        {issue.location&&<p className="break-words text-xs text-muted-foreground">位置：{issue.location}</p>}
        {(issue.reproduction||issue.expected||issue.actual||issue.evidence)&&<details className="text-xs"><summary className="cursor-pointer py-1 font-medium">复现与验证依据</summary><dl className="mt-2 space-y-2">{([['requirement','对应要求'],['impact','用户影响'],['reason','返工理由'],['reproduction','复现步骤'],['expected','预期结果'],['actual','实际结果'],['evidence','验证依据']] as const).map(([key,label])=>issue[key]&&<div key={key}><dt className="font-medium">{label}</dt><dd className="mt-1 whitespace-pre-wrap break-words text-muted-foreground">{issue[key]}</dd></div>)}</dl></details>}
      </article>)}</div>
    </div>}
    {!issues.length&&<p className="rounded-md bg-muted/30 p-3 text-sm">{output.verified?'本轮没有待修复问题。':pending.length?'尚无确认需要开发修复的问题，检查记录仍待核实。':'暂未记录问题，仍需等待完整验收结果。'}</p>}
    {!!pending.length&&<details className="rounded-md border p-3" aria-label="待核实记录"><summary className="cursor-pointer font-medium">待 QA 核实 · {pending.length} 项（不计开发返工）</summary><p className="mt-2 text-xs text-muted-foreground">需要补充分类、需求影响或测试证据；不会自动忽略，也不会作为已通过。</p><div className="mt-3 space-y-3">{pending.map((issue,index)=><div key={index} className="min-w-0 whitespace-pre-wrap break-words text-xs"><p className="font-medium">{index+1}. {issue.description}</p>{issue.reason&&<p>{issue.reason}</p>}{issue.evidence&&<details className="mt-1"><summary className="cursor-pointer">原始证据</summary><p className="mt-2 text-muted-foreground">{issue.evidence}</p></details>}</div>)}</div></details>}
    {!!advisories.length&&<details className="rounded-md border p-3" aria-label="非阻塞建议"><summary className="cursor-pointer font-medium">非阻塞建议 · {advisories.length} 项（不要求本轮修复）</summary><div className="mt-3 space-y-3">{advisories.map((issue,index)=><div key={index} className="min-w-0 whitespace-pre-wrap break-words text-xs"><p className="font-medium">{issue.description}</p><p className="mt-1 text-muted-foreground">{issue.reason}</p>{issue.impact&&<p>影响：{issue.impact}</p>}</div>)}</div></details>}
    {scenarios.map((scenario,index)=>{
      const execution=report?.scenarios.find(item=>item.name===scenario.name);
      return <details key={scenario.name} className="rounded-md border p-3">
        <summary className="cursor-pointer font-medium">{index+1}. {scenario.name} · {execution?statusLabels[execution.status]:'待执行'}</summary>
        <p className="mt-2 text-xs text-muted-foreground">此场景使用独立浏览器与空存储，不依赖其他场景的数据。</p>
        {(execution?.error||execution?.reason)&&<p className="mt-2 break-words">{execution.error||execution.reason}</p>}
        <ol className="mt-2 list-decimal space-y-1 pl-5">{scenario.tests.map((step,i)=><li key={i}><code className="break-all text-xs">{step.action} {step.selector} {step.value}</code></li>)}</ol>
        {!!execution?.logs?.length&&<pre className="mt-2 whitespace-pre-wrap break-words text-xs">{execution.logs.join('\n')}</pre>}
      </details>;
    })}
    {!!output.limitations?.length&&<div><h5 className="font-medium">验证限制与非阻塞建议</h5><ul className="mt-2 list-disc space-y-1 pl-5">{output.limitations.map((item,index)=><li key={index}>{item}</li>)}</ul></div>}
  </section>;
}
