import {useEffect,useState} from 'react';
import type {StudioRun,TeamOutput} from '@/lib/studio';
import {invoke,errorMessage} from '@/lib/sdk';
import QaReport from './QaReport';

type Feedback={id:number;created:string;attempt?:number;output:TeamOutput};
export default function QaPanel({run}:{run:StudioRun}){
  const [history,setHistory]=useState<Feedback[]>([]);
  const [error,setError]=useState('');
  const [loading,setLoading]=useState(true);
  const [retry,setRetry]=useState(0);
  const feedbackRevision=run.events.filter(event=>event.role==='qa'&&event.kind==='handoff'&&event.recipient==='engineer').map(event=>event.id??event.at).join(',');
  useEffect(()=>{
    let cancelled=false;
    setLoading(true);setError('');
    invoke<{items:Feedback[]}>({url:`/api/v1/studio/runs/${encodeURIComponent(run.id)}/qa-reports`})
      .then(result=>{if(!cancelled)setHistory(result.items);})
      .catch(reason=>{if(!cancelled)setError(errorMessage(reason));})
      .finally(()=>{if(!cancelled)setLoading(false);});
    return ()=>{cancelled=true;};
  },[run.id,feedbackRevision,retry]);
  const qa=run.result.team?.qa;
  return <div className="px-4 pb-4 sm:px-6">
    {qa?<QaReport output={qa}/>:<p className="delivery-help">尚未提交当前验收报告。</p>}
    <section aria-label="历次修复反馈" className="mt-4 space-y-3">
      <h5 className="text-sm font-semibold">历次修复反馈 · {history.length} 轮</h5>
      {loading&&<p className="text-xs text-muted-foreground" role="status">正在读取历史反馈…</p>}
      {error&&<p role="alert" className="text-xs text-destructive">历史反馈读取失败：{error} <button className="underline" onClick={()=>setRetry(value=>value+1)}>重试</button></p>}
      {!loading&&!error&&!history.length&&<p className="text-xs text-muted-foreground">暂无已保存的修复反馈。</p>}
      {history.map((entry,index)=><details key={entry.id} className="rounded-lg border p-3">
        <summary className="cursor-pointer text-sm">第 {entry.attempt??history.length-index} 次修复反馈 · {entry.output.issues?.length??0} 项问题<span className="ml-2 text-xs text-muted-foreground">{new Date(entry.created).toLocaleString('zh-CN',{hour12:false})}</span></summary>
        <QaReport output={entry.output} historical/>
      </details>)}
    </section>
  </div>;
}
