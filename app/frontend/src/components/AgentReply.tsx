import {ArrowRight, CheckCircle2, ChevronDown, CircleAlert, Copy, Loader2, Wrench} from 'lucide-react';
import Markdown from 'markdown-to-jsx';
import {toast} from 'sonner';
import AgentPersona from './AgentPersona';
import {Button} from '@/components/ui/button';
import {useAgentTeam} from './AgentProvider';
import {FALLBACK_TEAM} from '@/lib/agentProfiles';
import type {ConversationMessage, ConversationReply, ConversationStep} from '@/lib/conversation';
import {currentOutputFiles,diagnosticText} from '@/lib/conversation';

const toolNames: Record<string, string> = {'model.generate': '调用模型', 'runner.build_and_test': '构建与浏览器测试', 'workspace.apply_patch': '修改项目文件'};
const focusRing = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2';

function MessageBody({message}: {message: ConversationMessage}) {
  const detail=diagnosticText(message.detail.diagnostic);
  const legacyIssue=!detail&&(message.kind==='error'||message.detail.state==='error'||message.content.startsWith('退回工程师修复：'));
  const diagnostic=detail||(legacyIssue?message.content:undefined);
  const content=legacyIssue?'这一步曾遇到问题，详细原因已记录。当前进度请看上方任务状态。':message.content;
  return <>
    <div className="break-words leading-6 [&_p]:my-2 [&_p:first-child]:mt-0 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-4 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-4 [&_li]:my-1 [&_h1]:my-3 [&_h1]:font-semibold [&_h2]:my-3 [&_h2]:font-semibold [&_h3]:my-2 [&_h3]:font-semibold [&_pre]:overflow-auto [&_pre]:rounded [&_pre]:bg-muted [&_pre]:p-2 [&_a]:text-primary"><Markdown options={{disableParsingRawHTML:true,overrides:{img:({alt}:{alt?:string})=><span>{alt}</span>}}}>{content}</Markdown></div>
    {diagnostic&&<details className="mt-2 text-xs text-muted-foreground"><summary className={`cursor-pointer ${focusRing}`}>查看诊断详情</summary><pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words text-[11px]">{diagnostic}</pre></details>}
    {message.detail.output !== undefined && <details className="mt-2 rounded-md border bg-background/60 px-2.5 py-2">
      <summary className={`cursor-pointer text-xs text-muted-foreground ${focusRing}`}>查看交接文档 / 结果</summary>
      <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-all text-[11px] leading-5">{JSON.stringify(message.detail.output, null, 2)}</pre>
    </details>}
    {!!message.detail.plan?.length && <details className="mt-2">
      <summary className={`cursor-pointer text-xs text-muted-foreground ${focusRing}`}>建议与决策说明</summary>
      {message.detail.plan.map((line, i) => <p className="mt-2 whitespace-pre-wrap" key={i}>{line}</p>)}
    </details>}
  </>;
}

function ToolStep({step, active, filePaths, onOpenFile}: {step: ConversationStep; active: boolean; filePaths: string[]; onOpenFile: (path:string)=>void}) {
  const {message, result} = step;
  const outcome = result || (message.kind === 'tool_result' ? message : undefined);
  const failed = outcome?.detail.state === 'error';
  const output = outcome?.detail.output;
  const linkedFiles = currentOutputFiles(output, filePaths);
  const status = failed ? '未通过' : outcome ? '已完成' : active ? '执行中' : '无完成记录';
  return <div><details className="rounded-md border bg-muted/20 px-2.5 py-2">
    <summary className={`group/tool flex cursor-pointer list-none items-center gap-1.5 [&::-webkit-details-marker]:hidden ${focusRing}`}>
      <Wrench className="h-3 w-3 shrink-0"/>
      <span className="min-w-0 flex-1 break-words">{toolNames[message.detail.tool || ''] || message.detail.tool || '工具执行'}</span>
      <span className={`shrink-0 text-[10px] ${failed ? 'text-destructive' : ''}`}>{status}{outcome?.detail.duration_ms !== undefined ? ` · ${(outcome.detail.duration_ms / 1000).toFixed(1)}s` : ''}</span>
      <ChevronDown className="h-3 w-3 shrink-0 transition-transform group-open/tool:rotate-180"/>
    </summary>
    <div className="mt-2 space-y-2 border-t pt-2 text-[11px] leading-5">
      <p>{outcome?.content || message.content}</p>
      {message.detail.inputs !== undefined && <><p className="font-medium text-foreground">执行输入</p><pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all">{JSON.stringify(message.detail.inputs, null, 2)}</pre></>}
      {output !== undefined && <><p className="font-medium text-foreground">实际结果</p><pre className="max-h-72 overflow-auto whitespace-pre-wrap break-all">{JSON.stringify(output, null, 2)}</pre></>}
    </div>
  </details>{!!linkedFiles.length&&<div className="mt-1 rounded-md border bg-background p-2"><p className="mb-1 text-[10px] text-muted-foreground">相关文件 · 在文件页查看</p><button type="button" onClick={()=>onOpenFile(linkedFiles[0])} className="max-w-full break-all text-left text-primary hover:underline">{linkedFiles[0]}</button>{linkedFiles.length>1&&<details className="mt-1"><summary className="cursor-pointer text-[10px]">显示另外 {linkedFiles.length-1} 个文件</summary><div className="mt-2 flex flex-col items-start gap-2">{linkedFiles.slice(1).map(path=><button key={path} type="button" onClick={()=>onOpenFile(path)} className="max-w-full break-all text-left text-primary hover:underline">{path}</button>)}</div></details>}</div>}</div>;
}

export default function AgentReply({reply, active, waiting, expanded, onToggle, canEdit, onImplement, filePaths, onOpenFile}: {
  reply: ConversationReply; active: boolean; waiting: boolean; expanded: boolean; onToggle: () => void;
  canEdit: boolean; onImplement: (text: string) => void;
  filePaths: string[]; onOpenFile: (path:string)=>void;
}) {
  const first = reply.messages[0];
  const team=useAgentTeam(first.team||FALLBACK_TEAM);
  const person=first.detail.agent||reply.messages.find(message=>message.detail.agent)?.detail.agent||team[reply.sender];
  const roleName=(role:string)=>role==='user'?'你':role==='all'?'团队':(role===reply.sender?person?.title:team[role]?.name)||(role.startsWith('member:')?'智能体':role);
  const date = new Date(first.created);
  const failed = reply.steps.filter(s => s.message.kind === 'error' || (s.result || s.message).detail.state === 'error').length;
  if (reply.sender === 'user') return <article aria-label="你的消息" className="ml-8 flex justify-end py-2">
    <p className="max-w-full whitespace-pre-wrap break-words rounded-xl rounded-tr-sm bg-muted px-3 py-2 text-xs leading-6">{first.content}</p>
  </article>;
  return <article aria-label={`${roleName(reply.sender)}的回复`} className="min-w-0 py-2">
    <header className="mb-2 flex items-center gap-2 text-[11px] text-muted-foreground">
      {person?<AgentPersona role={reply.sender} profile={person} avatarClassName="h-9 w-9"/>:<span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted text-sm">?</span>}
      <span className="font-medium text-foreground">{person?.name || roleName(reply.sender)}</span>
      <span className="text-muted-foreground/40">|</span><span>{roleName(reply.sender)}</span>
      {!Number.isNaN(date.getTime()) && <time className="ml-auto text-[10px]" dateTime={first.created}>{date.toLocaleTimeString('zh-CN', {hour: '2-digit', minute: '2-digit', hour12: false})}</time>}
    </header>
    <div className="min-w-0 pl-11">
      {!!reply.steps.length && <>
        <button type="button" aria-expanded={expanded} aria-controls={`agent-process-${reply.id}`} onClick={onToggle} className={`mb-2 flex max-w-full flex-wrap items-center gap-1.5 rounded text-left text-[11px] text-muted-foreground hover:text-foreground ${focusRing}`}>
          {active ? <Loader2 className="h-3.5 w-3.5 animate-spin"/> : <CheckCircle2 className="h-3.5 w-3.5"/>}
          <span>{active ? '正在处理' : '已记录'} {reply.steps.length} 步</span>
          {waiting && <span className="text-primary">· 等待你确认</span>}
          {!!failed && <span>· 含检查反馈</span>}
          <ChevronDown className={`h-3 w-3 transition-transform ${expanded ? 'rotate-180' : ''}`}/>
        </button>
        <div id={`agent-process-${reply.id}`} role="region" aria-label={`${roleName(reply.sender)}的执行过程`} hidden={!expanded} className="mb-4 ml-1.5 border-l border-border/80">
          {reply.steps.map(step => <div key={step.message.id} className="relative pb-3 pl-4 text-[11px] leading-5 text-muted-foreground last:pb-0">
            <span className="absolute -left-[3px] top-2 h-[5px] w-[5px] rounded-full bg-border ring-2 ring-background"/>
            {step.message.kind.startsWith('tool_') ? <ToolStep step={step} active={active} filePaths={filePaths} onOpenFile={onOpenFile}/> : <>
              {step.message.recipient !== 'all' && <div className="mb-1 flex items-center gap-1 text-[10px]"><span>{roleName(step.message.sender)}</span><ArrowRight className="h-2.5 w-2.5"/>{roleName(step.message.recipient)}</div>}
              <MessageBody message={step.message}/>
            </>}
          </div>)}
        </div>
      </>}
      {reply.answer && <div className={`text-xs ${reply.answer.kind === 'error' ? 'text-destructive' : ''}`}>
        {reply.answer.kind === 'handoff' && <p className="mb-1 flex items-center gap-1 text-[11px] text-muted-foreground">交接给 <ArrowRight className="h-3 w-3"/>{roleName(reply.answer.recipient)}</p>}
        {reply.answer.kind === 'error' && <CircleAlert className="mb-1 h-4 w-4"/>}
        <MessageBody message={reply.answer}/>
        <button type="button" aria-label="复制回复" className="mt-2 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground" onClick={()=>{void navigator.clipboard.writeText(reply.answer!.content).then(()=>toast.success('已复制回复')).catch(()=>toast.error('复制失败，请手动选择文本'));}}><Copy className="h-3.5 w-3.5"/></button>
        {reply.answer.kind === 'chat' && canEdit && <Button size="sm" variant="ghost" className="mt-2 h-7 px-0 text-xs text-primary" onClick={() => onImplement('请参考以下角色讨论建议实施，并在关键节点向我确认：\n' + reply.answer!.content)}>作为团队需求</Button>}
      </div>}
    </div>
  </article>;
}
