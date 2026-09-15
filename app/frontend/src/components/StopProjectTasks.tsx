import {useRef,useState} from 'react';
import {Loader2,Square} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {invoke,errorMessage} from '@/lib/sdk';
import {toast} from 'sonner';

export interface StopResult {stopped_run_ids:string[];stopped_chats:number;saving_run_ids:string[]}

export default function StopProjectTasks({projectId,disabled,onStopped}:{projectId:number;disabled?:boolean;onStopped:(result:StopResult)=>void}){
  const [busy,setBusy]=useState(false);
  const lock=useRef(false);
  const stop=async()=>{
    if(lock.current)return;
    lock.current=true;setBusy(true);
    try{
      const result=await invoke<StopResult>({url:`/api/v1/studio/projects/${projectId}/stop`,method:'POST'});
      onStopped(result);
      if(result.saving_run_ids.length)toast.info('已停止其他智能体任务，正在保存的版本会完成当前写入。');
      else toast.success(result.stopped_run_ids.length||result.stopped_chats?'本项目的智能体任务已停止，草稿和交接进度已保留。':'本项目当前没有正在执行的智能体任务。');
    }catch(e){toast.error(errorMessage(e,'停止请求未完成，请重试'));}
    finally{lock.current=false;setBusy(false);}
  };
  return <Button variant="ghost" size="sm" disabled={disabled||busy} onClick={()=>void stop()} aria-label="强制停止本项目所有智能体任务" aria-busy={busy} title="停止本项目的整个团队与智能体对话，保留草稿，不影响其他项目" className="h-7 shrink-0 gap-1.5 px-2 text-[11px] text-muted-foreground hover:bg-destructive/10 hover:text-destructive">
    {busy?<Loader2 className="h-3 w-3 animate-spin"/>:<Square className="h-3 w-3"/>}{busy?'正在停止…':'强制停止'}
  </Button>;
}
