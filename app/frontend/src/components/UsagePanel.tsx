import {RefreshCw} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Skeleton} from '@/components/ui/skeleton';
import {useRecoveringQuery} from '@/hooks/useRecoveringQuery';
import BudgetPanel from './BudgetPanel';
interface Usage {input_tokens:number;output_tokens:number;scope:string;items:{model:string;stage:string;project_id:number;input_tokens:number;output_tokens:number;created:string}[]}
export default function UsagePanel(){
  const {data,refreshing,waiting,refresh}=useRecoveringQuery<Usage>('/api/v1/studio/usage');
  return <section aria-label="模型用量" className="mt-8 rounded-lg border bg-card p-5">
    <div className="flex items-center justify-between gap-3"><h2 className="font-semibold">模型用量</h2><Button variant="ghost" size="sm" disabled={refreshing} onClick={()=>void refresh()} aria-label="刷新模型用量"><RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${refreshing?'animate-spin':''}`}/>{refreshing?'同步中':'刷新'}</Button></div>
    {!data?<div role="status" className="my-4 space-y-3"><p className="text-sm text-muted-foreground">{waiting?'用量暂未同步，稍后会自动更新。':'正在同步模型用量…'}</p>{!waiting&&<Skeleton className="h-8 w-2/3"/>}</div>:<>
      {waiting&&<p role="status" className="mt-2 text-xs text-muted-foreground">显示最近一次同步的数据，稍后自动更新。</p>}
      <p className="my-3">输入 {data.input_tokens.toLocaleString()} tokens · 输出 {data.output_tokens.toLocaleString()} tokens</p><p className="text-xs text-muted-foreground">{data.scope}</p>
      {data.items.length?<div className="mt-3 max-h-60 overflow-auto"><table className="w-full text-left text-xs"><thead><tr><th>项目</th><th>模型 / 阶段</th><th>输入 / 输出</th></tr></thead><tbody>{data.items.map((r,i)=><tr key={i} className="border-t"><td className="py-2">#{r.project_id}</td><td>{r.model}<br/>{r.stage}</td><td>{r.input_tokens} / {r.output_tokens}</td></tr>)}</tbody></table></div>:<p className="mt-4 text-sm text-muted-foreground">还没有模型调用记录，开始生成应用后会在这里显示。</p>}
    </>}
    <BudgetPanel/>
  </section>;
}
