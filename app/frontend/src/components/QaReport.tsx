import type {TeamOutput} from '@/lib/studio';

/** Keep isolated scenario boundaries and genuine execution status visible. */
export default function QaReport({output}:{output:TeamOutput}) {
  const report=output.verification;
  const issues=report?.issues ?? output.issues ?? [];
  const scenarios=output.scenarios?.length ? output.scenarios
    : output.tests?.length ? [{name:'独立验收',tests:output.tests}] : [];
  const statusLabels={passed:'通过',failed:'失败',blocked:'阻塞 · 未执行'};
  return <section className="mt-4 space-y-3 rounded-lg border p-4 text-sm" aria-label="集中验收报告">
    <h5 className="font-semibold">集中验收报告</h5>
    <p>{output.verified ? '源码审查与全部必需测试已通过。'
      : report?.complete ? '本轮检查已完成，问题汇总后统一反馈。'
      : '本轮验收尚未完成；未执行的场景不会计为通过。'}</p>
    {output.summary&&<p className="text-muted-foreground">源码审查：{output.summary}</p>}
    {report?.selfTest&&<p>构建与开发自测：{report.selfTest.ok?'通过':'未通过'}{report.selfTest.error&&` · ${report.selfTest.error}`}</p>}
    {!!issues.length&&<div><h5 className="font-medium">集中反馈 · {issues.length} 项</h5><ol className="mt-2 list-decimal space-y-2 pl-5">{issues.map((issue,index)=><li key={index} className="break-words">{issue}</li>)}</ol></div>}
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
