import {useState} from 'react';
import MembersPanel from './MembersPanel';
import ConnectionsPanel from './ConnectionsPanel';
import ReportsPanel from './ReportsPanel';
import {toast} from 'sonner';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Label} from '@/components/ui/label';
import {Switch} from '@/components/ui/switch';
import {Textarea} from '@/components/ui/textarea';
import {Sheet,SheetTrigger,SheetContent,SheetHeader,SheetTitle,SheetDescription} from '@/components/ui/sheet';
import {invoke,errorMessage} from '@/lib/sdk';
import {studioUrl} from '@/lib/studio';

interface Cloud {enabled:boolean;ai_enabled:boolean;collections:Record<string,string>;slug:string}
interface Release {slug:string;version:number;active:boolean}
export default function ProjectTools({projectId,onChanged,disabled,role='owner'}:{projectId:number;onChanged:()=>void;disabled?:boolean;role?:string}) {
  const canManage=role==='owner';
  const [cloud,setCloud]=useState<Cloud>({enabled:false,ai_enabled:false,collections:{},slug:''});
  const [collections,setCollections]=useState('todos:private\nbookings:shared');
  const [release,setRelease]=useState<Release|null>(null);
  const [busy,setBusy]=useState(false);
  const [logs,setLogs]=useState('');
  const load=async()=>{
    try {
      const [c,r]=await Promise.all([invoke<Cloud>({url:studioUrl(projectId,'cloud')}),invoke<{release:Release|null}>({url:studioUrl(projectId,'release')})]);
      setCloud(c);setRelease(r.release);
      if(Object.keys(c.collections).length)setCollections(Object.entries(c.collections).map(([k,v])=>k+':'+v).join('\n'));
    }catch(e){toast.error(errorMessage(e));}
  };
  const perform=async(task:()=>Promise<void>)=>{setBusy(true);try{await task();onChanged();}catch(e){toast.error(errorMessage(e));}finally{setBusy(false);}};
  return <Sheet onOpenChange={open=>{if(open)void load();}}><SheetTrigger asChild><Button variant="outline" size="sm" disabled={disabled}>云服务与发布</Button></SheetTrigger>
    <SheetContent className="overflow-y-auto"><SheetHeader><SheetTitle>应用服务与发布</SheetTitle><SheetDescription>为生成的应用配置独立用户、数据和发布版本。</SheetDescription></SheetHeader>
      <div className="mt-5 space-y-5">
        {!canManage&&<p className="text-xs text-muted-foreground">当前为协作{role==='editor'?'编辑者':'查看者'}。发布与服务配置由项目所有者管理。</p>}
        <div className="flex justify-between"><Label>开启应用云服务</Label><Switch disabled={!canManage} checked={cloud.enabled} onCheckedChange={enabled=>setCloud({...cloud,enabled})}/></div>
        <p className="text-xs text-muted-foreground">应用用户需单独注册，与工作台账号独立。private 集合仅本人读写；shared 集合所有已登录的应用用户均可读写。</p>
        <Label>数据集合（每行 集合名:权限）</Label><Textarea disabled={!canManage} value={collections} onChange={e=>setCollections(e.target.value)} className="font-mono"/>
        <div className="flex justify-between"><Label>允许应用调用 AI</Label><Switch disabled={!canManage} checked={cloud.ai_enabled} onCheckedChange={ai_enabled=>setCloud({...cloud,ai_enabled})}/></div>
        <p className="text-xs text-muted-foreground">应用 AI 消耗当前服务的模型额度，须先登录应用，已设置请求频率限制。</p>
        <Button disabled={busy||!canManage} onClick={()=>void perform(async()=>{
          const entries=collections.split('\n').filter(x=>x.trim()).map(x=>x.trim().split(':').map(s=>s.trim()));
          if(entries.some(x=>x.length!==2))throw Error('请按 集合名:private 或 集合名:shared 填写');
          await invoke({url:studioUrl(projectId,'cloud'),method:'PUT',data:{...cloud,collections:Object.fromEntries(entries)}});await load();toast.success('应用云服务配置已保存');
        })}>保存配置</Button>
        <div className="border-t pt-4"><h3 className="font-semibold">构建与浏览器检查</h3>
          <p className="my-2 text-xs text-muted-foreground">在隔离环境安装预置依赖并检查页面运行。修改源码或回滚后，可重新构建当前版本。</p>
          <Button variant="outline" disabled={busy} onClick={()=>void perform(async()=>{const r=await invoke<{logs:string[]}>({url:studioUrl(projectId,'build'),method:'POST',timeoutMs:90000});setLogs(r.logs.join('\n'));toast.success('构建检查通过');})}>{busy?'处理中…':'构建当前版本'}</Button>
          {logs&&<pre className="mt-2 whitespace-pre-wrap text-xs">{logs}</pre>}
        </div>
        <div className="border-t pt-4"><h3 className="font-semibold">发布独立应用</h3><p className="my-2 text-xs text-muted-foreground">发布保存当前构建快照，后续编辑不影响已发布版本。回滚项目后重新构建并发布，可恢复旧功能。</p>
          <Button disabled={busy||!canManage} onClick={()=>void perform(async()=>{const r=await invoke<Release>({url:studioUrl(projectId,'release'),method:'POST'});setRelease({...r,active:true});toast.success('发布成功');})}>发布当前版本</Button>
          {release?.active&&<div className="mt-3 space-y-2"><p className="text-xs">已发布 v{release.version}</p><Input readOnly value={window.location.origin+'/apps/'+release.slug}/><a className="block text-sm text-primary underline" target="_blank" rel="noreferrer" href={'/apps/'+release.slug}>打开应用</a><Button variant="outline" disabled={busy} onClick={()=>void perform(async()=>{await invoke({url:studioUrl(projectId,'release'),method:'DELETE'});await load();})}>下线应用</Button></div>}
        </div>
        <MembersPanel projectId={projectId}/>
        <ConnectionsPanel projectId={projectId}/>
        <ReportsPanel projectId={projectId}/>
      </div>
    </SheetContent>
  </Sheet>;
}
