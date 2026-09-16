import {useEffect,useState} from 'react';
import {invoke,errorMessage} from '@/lib/sdk';
import {agentLabel,type RunEventPage,type StudioRun} from '@/lib/studio';
import {Button} from './ui/button';

/** Cursor pages stay fixed while new live events arrive. */
export default function RunLog({run}:{run:StudioRun}) {
  const [open,setOpen]=useState(false);
  const [cursors,setCursors]=useState<number[]>([]);
  const [page,setPage]=useState<RunEventPage|null>(null);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [retry,setRetry]=useState(0);
  const before=cursors[cursors.length-1];
  const latest=run.events[run.events.length-1];
  const liveRevision=before===undefined ? (latest?.id ?? latest?.at ?? '') : '';
  useEffect(()=>{
    if(!open)return;
    let cancelled=false;
    setBusy(true);setError('');
    invoke<RunEventPage>({url:`/api/v1/studio/runs/${encodeURIComponent(run.id)}/events?limit=100${before===undefined?'':`&before=${before}`}`})
      .then(result=>{if(!cancelled)setPage(result);})
      .catch(reason=>{if(!cancelled)setError(errorMessage(reason));})
      .finally(()=>{if(!cancelled)setBusy(false);});
    return ()=>{cancelled=true;};
  },[run.id,open,before,liveRevision,retry]);
  const total=Math.max(page?.total??0,run.events_total??run.events.length);
  const navigate=(next:number[])=>{setPage(null);setCursors(next);};
  return <details className="rounded-xl border bg-background p-4" open={open} onToggle={e=>setOpen(e.currentTarget.open)}>
    <summary className="cursor-pointer font-medium">执行日志（已保存 {total} 条）</summary>
    <div className="mt-4 space-y-3" aria-label="执行日志历史">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" disabled={busy||!page?.has_more} onClick={()=>page?.next_before&&navigate([...cursors,page.next_before])}>查看更早</Button>
        <Button size="sm" variant="outline" disabled={busy||!cursors.length} onClick={()=>navigate(cursors.slice(0,-1))}>查看更新</Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={()=>{navigate([]);setRetry(value=>value+1);}}>回到最新</Button>
        <span className="text-xs text-muted-foreground">{before===undefined?'最新记录':'历史记录'} · 每页最多 100 条</span>
      </div>
      {error&&<div role="alert" className="text-sm text-destructive">日志读取失败：{error} <button className="underline" onClick={()=>setRetry(value=>value+1)}>重试</button></div>}
      {busy&&!page&&<p role="status" className="text-xs">正在读取日志…</p>}
      {page?.notice&&<p className="text-xs text-muted-foreground">{page.notice}</p>}
      {page&&!page.items.length&&<p className="text-xs text-muted-foreground">暂无执行日志。</p>}
      <ol className="max-h-[36rem] space-y-4 overflow-y-auto pr-2 text-xs" aria-busy={busy}>
        {page?.items.map(entry=><li key={entry.id} className="border-l-2 border-border pl-3">
          <div className="mb-1 flex flex-wrap gap-x-3 gap-y-1 text-muted-foreground"><span>{entry.role?(run.agents?.[entry.role]?.title||agentLabel(entry.role)):'执行记录'}</span><time dateTime={entry.at}>{new Date(entry.at).toLocaleString('zh-CN',{hour12:false})}</time></div>
          <p className="whitespace-pre-wrap break-words">{entry.message}</p>
        </li>)}
      </ol>
      {page&&!page.has_more&&!!page.items.length&&<p className="text-xs text-muted-foreground">已到最早保存的记录。</p>}
    </div>
  </details>;
}
