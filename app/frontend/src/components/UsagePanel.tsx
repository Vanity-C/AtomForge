import {useCallback, useEffect, useState} from 'react';
import {ChevronDown, RefreshCw} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Skeleton} from '@/components/ui/skeleton';
import {useRecoveringQuery} from '@/hooks/useRecoveringQuery';
import BudgetPanel from './BudgetPanel';
import {invoke} from '@/lib/sdk';
import {findModel} from '@/lib/agent/modelProvider';
interface ProjectUsage {project_id:number;name:string;input_tokens:number;output_tokens:number;calls:number;last_used:string}
interface Usage {input_tokens:number;output_tokens:number;scope:string;projects:ProjectUsage[]}
interface UsageItem {id:number;model:string;provider:string;stage:string;run_id:string;input_tokens:number;output_tokens:number;created:string}
interface UsagePage {items:UsageItem[];next_cursor:number|null}
const stages:Record<string,string>={plan:'需求规划',code:'代码生成',repair:'自动修复',team_pm:'产品规划',team_designer:'界面设计',team_architect:'架构设计',team_engineer:'代码生成',team_qa:'测试检查','app-ai':'应用 AI'};

function UsageDetails({projectId}:{projectId:number}) {
  const [page,setPage]=useState<UsagePage>();
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState('');
  const load=useCallback(async (before?:number)=>{
    setLoading(true);setError('');
    try {
      const next=await invoke<UsagePage>({url:`/api/v1/studio/usage/projects/${projectId}${before?`?before=${before}`:''}`});
      setPage(previous=>({items:before?[...(previous?.items??[]),...next.items]:next.items,next_cursor:next.next_cursor}));
    } catch {setError('调用明细暂未加载，请重试。');}
    finally {setLoading(false);}
  },[projectId]);
  useEffect(()=>{void load();},[load]);
  return <div className="border-t px-4 pb-4">
    <div className="max-h-80 overflow-auto"><table className="w-full text-left text-xs">
      <caption className="py-3 text-left text-muted-foreground">按调用时间倒序 · 包含重试与自动修复</caption>
      <thead><tr><th className="pb-2">模型 / 阶段</th><th>输入 / 输出</th><th>时间</th></tr></thead>
      <tbody>{page?.items.map(row=><tr key={row.id} className="border-t">
        <td className="py-3 pr-3"><p>{findModel(row.model).label}</p><p className="mt-1 text-muted-foreground">{stages[row.stage]??row.stage} · {row.provider==='codex'?'Codex 账号':'DeepSeek API'}</p></td>
        <td className="whitespace-nowrap pr-3 tabular-nums">{row.input_tokens.toLocaleString()} / {row.output_tokens.toLocaleString()}</td>
        <td className="whitespace-nowrap text-muted-foreground">{new Date(row.created).toLocaleString()}</td>
      </tr>)}</tbody>
    </table></div>
    {error&&<p role="alert" className="py-2 text-sm text-destructive">{error}</p>}
    {loading?<p role="status" className="py-2 text-sm text-muted-foreground">正在加载明细…</p>:
      (error||page?.next_cursor)&&<Button variant="outline" size="sm" onClick={()=>void load(page?.next_cursor??undefined)}>{error?'重试':'加载更多'}</Button>}
    {page&&!page.items.length&&<p className="text-sm text-muted-foreground">暂无调用记录。</p>}
  </div>;
}

function ProjectRow({project}:{project:ProjectUsage}) {
  const [open,setOpen]=useState(false);
  return <div className="rounded-lg border">
    <button type="button" aria-expanded={open} aria-controls={`usage-${project.project_id}`} onClick={()=>setOpen(value=>!value)} className="flex w-full items-center gap-3 p-4 text-left hover:bg-muted/40">
      <ChevronDown aria-hidden className={`h-4 w-4 shrink-0 transition-transform ${open?'':'-rotate-90'}`}/>
      <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{project.name}</p><p className="mt-1 text-xs text-muted-foreground">#{project.project_id} · {project.calls.toLocaleString()} 次调用</p></div>
      <div className="text-right text-xs tabular-nums"><p className="font-medium">{(project.input_tokens+project.output_tokens).toLocaleString()} tokens</p><p className="mt-1 text-muted-foreground">输入 {project.input_tokens.toLocaleString()} · 输出 {project.output_tokens.toLocaleString()}</p></div>
    </button>
    <div id={`usage-${project.project_id}`} hidden={!open}>{open&&<UsageDetails key={project.last_used} projectId={project.project_id}/>}</div>
  </div>;
}
export default function UsagePanel(){
  const {data,refreshing,waiting,refresh}=useRecoveringQuery<Usage>('/api/v1/studio/usage');
  return <section aria-label="模型用量" className="mt-8 rounded-lg border bg-card p-5">
    <div className="flex items-center justify-between gap-3"><h2 className="font-semibold">项目模型用量</h2><Button variant="ghost" size="sm" disabled={refreshing} onClick={()=>void refresh()} aria-label="刷新模型用量"><RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${refreshing?'animate-spin':''}`}/>{refreshing?'同步中':'刷新'}</Button></div>
    {!data?<div role="status" className="my-4 space-y-3"><p className="text-sm text-muted-foreground">{waiting?'用量暂未同步，稍后会自动更新。':'正在同步模型用量…'}</p>{!waiting&&<Skeleton className="h-8 w-2/3"/>}</div>:<>
      {waiting&&<p role="status" className="mt-2 text-xs text-muted-foreground">显示最近一次同步的数据，稍后自动更新。</p>}
      <p className="my-3">输入 {data.input_tokens.toLocaleString()} tokens · 输出 {data.output_tokens.toLocaleString()} tokens</p><p className="text-xs text-muted-foreground">{data.scope}</p>
      {data.projects.length?<div className="mt-4 space-y-3">{data.projects.map(project=><ProjectRow key={project.project_id} project={project}/>)}</div>:<p className="mt-4 text-sm text-muted-foreground">还没有模型调用记录，开始生成应用后会在这里显示。</p>}
    </>}
    <BudgetPanel/>
  </section>;
}
