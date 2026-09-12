import {useCallback,useEffect,useRef,useState} from 'react';
import {MessageSquare} from 'lucide-react';
import ConfirmationCard from './ConfirmationCard';
import {Button} from '@/components/ui/button';
import {Textarea} from '@/components/ui/textarea';
import {ScrollArea} from '@/components/ui/scroll-area';
import {TEAM_ROLES,agentLabel,type StudioRun} from '@/lib/studio';
import AgentPersona from './AgentPersona';
import {invoke,errorMessage} from '@/lib/sdk';
import {toast} from 'sonner';

import AgentReply from './AgentReply';
import {groupConversation,type ConversationMessage as Message} from '@/lib/conversation';
const name=(role:string)=>role==='user'?'你':role==='all'?'团队':agentLabel(role);

export default function AgentConversation({projectId,run,role,onRole,team,model,canEdit,onUpdated,onImplement,legacy,filePaths,onOpenFile}:{projectId:number;run:StudioRun|null;role:string;onRole:(role:string)=>void;team:boolean;model:string;canEdit:boolean;onUpdated:()=>void;onImplement:(text:string)=>void;legacy:{key:string;role:string;content:string}[];filePaths:string[];onOpenFile:(path:string)=>void}) {
  const [items,setItems]=useState<Message[]>([]);
  const [expanded,setExpanded]=useState<Record<string,boolean>>({});
  const [before,setBefore]=useState<number|null>(null);
  const [error,setError]=useState('');
  const [drafts,setDrafts]=useState<Record<string,string>>({});
  const [busy,setBusy]=useState(false);
  const [following,setFollowing]=useState(true);
  const followRef=useRef(true);
  const bottom=useRef<HTMLDivElement>(null);
  const confirmationTop=useRef<HTMLDivElement>(null);
  const scope=useRef('');
  scope.current=`${projectId}:${role}`;
  const pending=run?.result.pending;
  const replies=groupConversation(items);
  const refresh=useCallback(async()=>{
    const data=await invoke<{items:Message[];next_before:number|null}>({url:`/api/v1/studio/projects/${projectId}/conversations?role=${role}`});
    if(scope.current!==`${projectId}:${role}`)return;
    setItems(previous=>[...new Map([...previous,...data.items].map(item=>[item.id,item])).values()].sort((a,b)=>a.id-b.id));
    setError('');
  },[projectId,role]);
  useEffect(()=>{
    let live=true;let first=true;let timer:ReturnType<typeof setTimeout>;
    setItems([]);setBefore(null);
    followRef.current=true;setFollowing(true);
    const poll=async()=>{try{const data=await invoke<{items:Message[];next_before:number|null}>({url:`/api/v1/studio/projects/${projectId}/conversations?role=${role}`});if(live&&scope.current===`${projectId}:${role}`){setItems(previous=>[...new Map([...previous,...data.items].map(item=>[item.id,item])).values()].sort((a,b)=>a.id-b.id));if(first){setBefore(data.next_before);first=false;}setError('');}}catch{if(live)setError('连接暂时中断，正在自动恢复；已有对话仍保留。');}finally{if(live)timer=setTimeout(()=>void poll(),2000);}};
    void poll();
    return()=>{live=false;clearTimeout(timer);};
  },[projectId,role]);
  useEffect(()=>{if(!pending&&followRef.current)bottom.current?.scrollIntoView({block:'nearest'});},[items.at(-1)?.id,pending,role]);
  useEffect(()=>{if(pending)confirmationTop.current?.scrollIntoView({block:'start'});},[pending?.id,role]);
  const older=async()=>{
    if(!before)return;
    try{const data=await invoke<{items:Message[];next_before:number|null}>({url:`/api/v1/studio/projects/${projectId}/conversations?role=${role}&before=${before}`});setItems(previous=>[...new Map([...data.items,...previous].map(item=>[item.id,item])).values()].sort((a,b)=>a.id-b.id));setBefore(data.next_before);}catch(e){toast.error(errorMessage(e));}
  };
  const send=async()=>{
    const text=drafts[role]?.trim();if(!text||busy||role==='all')return;
    setBusy(true);setDrafts(previous=>({...previous,[role]:''}));
    try{await invoke({url:`/api/v1/studio/projects/${projectId}/conversations`,method:'POST',data:{role,content:text,model}});await refresh();}catch(e){setDrafts(previous=>({...previous,[role]:text}));toast.error(errorMessage(e));}finally{setBusy(false);}
  };
  return <div className="flex min-h-0 flex-1 flex-col">
    <div className="shrink-0 border-b px-3 py-2">
      <div className="flex items-center gap-2"><MessageSquare className="h-3.5 w-3.5 text-muted-foreground"/><select aria-label="智能体会话" disabled={busy} value={role} onChange={e=>onRole(e.target.value)} className="min-w-0 flex-1 rounded-lg bg-transparent px-2 py-1.5 text-xs"><option value="all">{team?'团队对话 · 全部成员':'Neo · 应用工程师'}</option>{team&&TEAM_ROLES.map(r=><option key={r.id} value={r.id}>{r.alias} · {r.name}</option>)}</select></div>
      {team&&<div className="mt-1 flex items-center gap-2" aria-label="团队成员会话">{TEAM_ROLES.map(r=><AgentPersona key={r.id} role={r.id} label={`与 ${r.alias} ${r.name} 对话`} selected={role===r.id} disabled={busy} onClick={()=>onRole(r.id)} avatarClassName="h-9 w-9" className={`p-0.5 ${role===r.id?'ring-2 ring-primary':'ring-1 ring-transparent'}`}/>)}</div>}
    </div>
    {pending&&run?.status==='awaiting_input'&&role!=='all'&&role!==pending.role&&<button type="button" className="shrink-0 border-b bg-primary/5 px-3 py-2 text-left text-xs text-primary" onClick={()=>onRole(pending.role)}>有待确认事项 · 查看产品经理的确认卡</button>}
    <ScrollArea className="min-h-0 flex-1" onScrollCapture={e=>{const viewport=e.target as HTMLElement;if(!viewport.hasAttribute('data-radix-scroll-area-viewport'))return;const nearBottom=viewport.scrollHeight-viewport.scrollTop-viewport.clientHeight<100;followRef.current=nearBottom;setFollowing(nearBottom);}}><div className="space-y-3 px-3 py-3">
      {error&&<p className="text-xs text-muted-foreground" role="status">{error}</p>}
      {before&&<Button variant="ghost" size="sm" className="w-full text-xs" onClick={()=>void older()}>加载更早记录</Button>}
      {!items.length&&role==='all'&&legacy.map(m=><div key={m.key} className={`whitespace-pre-wrap rounded-lg p-3 text-sm ${m.role==='user'?'ml-5 bg-primary text-primary-foreground':'bg-muted'}`}>{m.content}</div>)}
      {!items.length&&role!=='all'&&<p className="py-6 text-center text-xs leading-6 text-muted-foreground">直接向{name(role)}提问。此会话也会显示该角色收到和发出的交接记录。</p>}
      {replies.map((reply,index)=>{
        const last=index===replies.length-1;
        const current=!!run&&reply.runId===run.id;
        const active=last&&(current&&['queued','running'].includes(run.status)||!reply.runId&&busy&&reply.sender===role);
        const waiting=last&&current&&run.status==='awaiting_input';
        const key=`${projectId}:${reply.id}`;
        const open=expanded[key]??active;
        return <AgentReply key={key} reply={reply} active={active} waiting={waiting} expanded={open} onToggle={()=>setExpanded(previous=>({...previous,[key]:!open}))} canEdit={canEdit} onImplement={onImplement} filePaths={filePaths} onOpenFile={onOpenFile}/>;
      })}
      {pending&&run?.status==='awaiting_input'&&(role==='all'||role===pending.role)&&<div ref={confirmationTop}><ConfirmationCard key={pending.id} runId={run.id} pending={pending} serverTime={run.server_time} canEdit={canEdit&&!busy} onUpdated={()=>{onUpdated();void refresh();}}/></div>}
      <div ref={bottom}/>
    </div></ScrollArea>
    {!following&&<button type="button" className="shrink-0 border-t bg-background px-3 py-2 text-xs text-primary" onClick={()=>{followRef.current=true;setFollowing(true);bottom.current?.scrollIntoView({block:'nearest'});}}>回到最新进展 ↓</button>}
    {role!=='all'&&<div className="shrink-0 space-y-2 border-t p-3"><p className="text-[11px] leading-5 text-muted-foreground">与{name(role)}讨论；开发改动通过确认卡或“作为团队需求”提交。</p><Textarea aria-label={`给${name(role)}的消息`} value={drafts[role]||''} onChange={e=>setDrafts(previous=>({...previous,[role]:e.target.value}))} disabled={!canEdit||busy} placeholder={`向${name(role)}提问…`} className="min-h-20 text-xs"/><Button className="w-full" size="sm" disabled={!canEdit||busy||!drafts[role]?.trim()} onClick={()=>void send()}>{busy?'正在回复…':'发送给'+name(role)}</Button></div>}
  </div>;
}
