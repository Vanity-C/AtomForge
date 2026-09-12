import StudioSelect from '@/components/StudioSelect';
import {useRef,useState} from 'react';
import {Link} from 'react-router-dom';
import {Check,Loader2,Plus,RotateCcw,Upload,Users,ArrowLeft,Pencil,Trash2} from 'lucide-react';
import {toast} from 'sonner';
import {TopBar,LoginGate,useAuth} from '@/components/AppShell';
import {useAgents} from '@/components/AgentProvider';
import AgentAvatar from '@/components/AgentAvatar';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Textarea} from '@/components/ui/textarea';
import {Label} from '@/components/ui/label';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import {AlertDialog,AlertDialogContent,AlertDialogHeader,AlertDialogTitle,AlertDialogDescription,AlertDialogFooter,AlertDialogCancel} from '@/components/ui/alert-dialog';
import {ROLE_LABELS,type AgentProfile,type AgentRole,type AgentConfiguration} from '@/lib/agentProfiles';
import {errorMessage} from '@/lib/sdk';

export default function Agents(){
  const {authState,user}=useAuth();
  const {config,loading,error,refresh,save}=useAgents();
  const [editing,setEditing]=useState<AgentProfile>();
  const [creating,setCreating]=useState(false);
  const [activate,setActivate]=useState(true);
  const [saving,setSaving]=useState(false);
  const [reading,setReading]=useState(false);
  const [notice,setNotice]=useState('');
  const [confirm,setConfirm]=useState<'reset'|AgentProfile>();
  const file=useRef<HTMLInputElement>(null);
  const roles=Object.keys(ROLE_LABELS) as AgentRole[];
  const persist=async(value:AgentConfiguration)=>{
    setSaving(true);setNotice('');
    try{await save(value);toast.success('智能体设置已保存');return true;}
    catch(e){setNotice(errorMessage(e));return false;}
    finally{setSaving(false);}
  };
  const edit=(agent:AgentProfile,isNew=false)=>{setEditing({...agent});setCreating(isNew);setActivate(true);setNotice('');};
  const create=()=>{if(config?.defaults)edit({...config.defaults.agents.find(a=>a.role==='engineer')!,id:crypto.randomUUID(),name:'我的工程师'},true);};
  const submit=async(e:React.FormEvent)=>{
    e.preventDefault();if(!config||!editing||saving||reading)return;
    const agents=creating?[...config.agents,editing]:config.agents.map(a=>a.id===editing.id?editing:a);
    if(await persist({...config,agents,active:creating&&activate?{...config.active,[editing.role]:editing.id}:config.active}))setEditing(undefined);
  };
  const upload=async(image?:File)=>{
    if(!image||!editing)return;
    if(!['image/png','image/jpeg','image/webp'].includes(image.type)||image.size>1024*1024){setNotice('请选择不超过 1 MB 的 PNG、JPG 或 WebP 图片');return;}
    setReading(true);setNotice('');
    try{
      const value=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=reject;reader.readAsDataURL(image);});
      setEditing(previous=>previous?{...previous,avatar:value}:previous);
    }catch{setNotice('图片读取失败，请重新选择');}finally{setReading(false);}
  };
  const performConfirm=async()=>{
    if(!config||!confirm)return;
    const next=confirm==='reset'?{...config.defaults!,revision:config.revision}:{...config,agents:config.agents.filter(a=>a.id!==confirm.id)};
    if(await persist(next))setConfirm(undefined);
  };
  return <div className="min-h-screen bg-background">
    <TopBar authState={authState} user={user} brandTo="/dashboard"/>
    {authState==='anonymous'?<LoginGate title="登录后组建你的智能体团队" description="创建专属伙伴，定制头像、性格和职责。设置只属于你的账号。"/>:
    <main className="agents-page studio-page py-8 sm:py-12">
      <Link to="/dashboard" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"><ArrowLeft className="h-3 w-3"/>返回我的项目</Link>
      <div className="mt-6 flex flex-wrap items-end justify-between gap-5">
        <div><p className="studio-kicker">THE PEOPLE / 你的团队</p><h1 className="mt-3 text-4xl font-semibold tracking-tight">好作品，来自好搭档。</h1><p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">有人善于倾听，有人追求细节，也有人擅长把想法落地。让每位伙伴都有自己的名字、表达方式和工作重点。</p></div>
        <div className="flex gap-2"><Button variant="outline" disabled={!config||saving} onClick={()=>setConfirm('reset')}><RotateCcw className="mr-2 h-4 w-4"/>恢复默认团队</Button><Button disabled={!config?.defaults||saving||config.agents.length>=24} onClick={create}><Plus className="mr-2 h-4 w-4"/>新建智能体</Button></div>
      </div>
      {notice&&!editing&&<p role="alert" className="mt-4 text-sm text-destructive">{notice}<Button variant="ghost" size="sm" disabled={loading||saving} onClick={()=>void refresh()}>重新加载设置</Button></p>}
      {error&&<div role="alert" className="mt-6 rounded-lg border p-4 text-sm">{error}<Button variant="ghost" size="sm" disabled={loading} onClick={()=>void refresh()}>重新加载</Button></div>}
      {!config?<p role="status" className="mt-12 flex items-center gap-2 text-sm text-muted-foreground">{loading&&<Loader2 className="h-4 w-4 animate-spin"/>}{loading?'正在加载你的伙伴…':'暂未加载智能体设置。'}</p>:<>
        <section className="agent-roster mt-9 border-y py-6" aria-label="当前协作团队">
          <h2 className="flex items-center gap-2 text-base font-semibold"><Users className="h-4 w-4 text-primary"/>当前协作团队</h2>
          <p className="mt-2 text-xs leading-5 text-muted-foreground">团队领导负责接待与调度，各专业岗位负责需求、设计、架构、开发和独立测试。新任务使用这里的安排，运行中的任务保留原有成员。</p>
          <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-6">{roles.map(role=>{
            const member=config.agents.find(a=>a.id===config.active[role])!;
            return <div key={role} className="flex items-center gap-3 border-l border-border px-3 py-2 lg:flex-col lg:items-start">
              <AgentAvatar role={role} person={member} className="h-12 w-12"/>
              <div className="min-w-0 w-full"><p className="text-[10px] font-medium text-muted-foreground">{ROLE_LABELS[role]}伙伴</p>
              <StudioSelect aria-label={`${ROLE_LABELS[role]}岗位成员`} value={member.id} disabled={saving} onValueChange={value=>void persist({...config,active:{...config.active,[role]:value}})} className="mt-1" compact options={config.agents.filter(a=>a.role===role).map(a=>({value:a.id,label:a.name}))}/></div>
            </div>;
          })}</div>
        </section>
        <div className="mb-4 mt-9 flex items-center justify-between"><h2 className="text-lg font-semibold">我的智能体 <span className="ml-2 text-sm font-normal text-muted-foreground">{config.agents.length} / 24</span></h2><p className="text-xs text-muted-foreground">账号专属 · 自动应用到新任务</p></div>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{config.agents.map(agent=>{
          const active=config.active[agent.role]===agent.id;
          return <article key={agent.id} className="agent-dossier flex flex-col border bg-card p-5" aria-label={`${agent.name}的智能体资料`}>
            <div className="flex items-center gap-3"><AgentAvatar role={agent.role} person={agent} className="h-16 w-16"/><div className="min-w-0"><h3 className="truncate font-semibold">{agent.name}</h3><p className="mt-1 truncate text-xs text-muted-foreground">{agent.title}</p><span className={`mt-2 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] ${active?'bg-primary/10 text-primary':'bg-muted text-muted-foreground'}`}>{active&&<Check className="h-3 w-3"/>}{active?'当前成员':agent.id.startsWith('default-')?'默认伙伴':'专属伙伴'}</span></div></div>
            <p className="mt-5 border-y py-4 text-sm leading-7 font-medium">“{agent.greeting}”</p>
            <p className="mt-4 text-[10px] font-medium text-muted-foreground">性格与表达</p><p className="mt-1 line-clamp-3 text-xs leading-6">{agent.personality}</p>
            <p className="mt-3 text-[10px] font-medium text-muted-foreground">职责与关注点</p><p className="mt-1 line-clamp-3 text-xs leading-6">{agent.responsibilities}</p>
            <div className="mt-auto flex gap-2 pt-5"><Button className="flex-1" variant="outline" size="sm" disabled={saving} onClick={()=>edit(agent)}><Pencil className="mr-2 h-3 w-3"/>编辑资料</Button>{!active&&<Button size="sm" variant="secondary" disabled={saving} onClick={()=>void persist({...config,active:{...config.active,[agent.role]:agent.id}})}>加入团队</Button>}{!agent.id.startsWith('default-')&&!active&&<Button variant="ghost" size="icon" aria-label={`删除${agent.name}`} disabled={saving} onClick={()=>setConfirm(agent)}><Trash2 className="h-4 w-4"/></Button>}</div>
          </article>;
        })}</div>
      </>}
    </main>}
    <Dialog open={!!editing} onOpenChange={open=>{if(!open&&!saving&&!reading)setEditing(undefined);}}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto" onInteractOutside={e=>e.preventDefault()}>
        <DialogHeader><DialogTitle>{creating?'创建专属智能体':'编辑智能体'}</DialogTitle><DialogDescription>头像用于对话和团队看板；性格与职责会影响实际回复和协作方式。</DialogDescription></DialogHeader>
        {editing&&<form onSubmit={submit} className="space-y-5"><fieldset disabled={saving||reading} className="space-y-5">
          <div className="flex items-center gap-4"><AgentAvatar role={editing.role} person={editing} className="h-20 w-20"/><div className="space-y-2"><div className="flex flex-wrap gap-2"><Button type="button" variant="outline" size="sm" onClick={()=>file.current?.click()}><Upload className="mr-2 h-3 w-3"/>{reading?'读取中…':'上传头像'}</Button>{editing.avatar&&<Button type="button" variant="ghost" size="sm" onClick={()=>setEditing({...editing,avatar:''})}>使用内置头像</Button>}</div><p className="text-[11px] text-muted-foreground">PNG、JPG、WebP，最大 1 MB</p><input ref={file} aria-label="选择智能体头像" type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={e=>{void upload(e.target.files?.[0]);e.target.value='';}}/></div></div>
          {!editing.avatar&&<div className="flex gap-2" aria-label="内置头像选择">{roles.map(style=><button key={style} type="button" aria-label={`${ROLE_LABELS[style]}风格头像`} aria-pressed={editing.avatar_style===style} onClick={()=>setEditing({...editing,avatar_style:style})} className={`rounded-full p-1 ${editing.avatar_style===style?'ring-2 ring-primary':'ring-1 ring-border'}`}><AgentAvatar role={style} person={{...editing,avatar_style:style}} className="h-10 w-10"/></button>)}</div>}
          <div className="grid gap-4 sm:grid-cols-2"><div className="space-y-2"><Label htmlFor="agent-name">名字</Label><Input id="agent-name" required maxLength={40} value={editing.name} onChange={e=>setEditing({...editing,name:e.target.value})}/></div><div className="space-y-2"><Label htmlFor="agent-title">职责名称</Label><Input id="agent-title" required maxLength={60} value={editing.title} onChange={e=>setEditing({...editing,title:e.target.value})}/></div></div>
          <div className="space-y-2"><Label htmlFor="agent-role">协作岗位</Label><StudioSelect id="agent-role" aria-label="协作岗位" disabled={!creating} value={editing.role} onValueChange={value=>setEditing({...editing,role:value as AgentRole})} options={roles.map(role=>({value:role,label:ROLE_LABELS[role]}))}/><p className="text-[11px] text-muted-foreground">岗位决定参与哪一步协作；职责描述决定这一岗位的工作重点。</p></div>
          <div className="space-y-2"><Label htmlFor="agent-personality">性格与表达方式</Label><Textarea id="agent-personality" required maxLength={1000} rows={3} value={editing.personality} onChange={e=>setEditing({...editing,personality:e.target.value})} placeholder="例如：耐心、坦率，先用具体例子解释，再给出简洁建议。"/></div>
          <div className="space-y-2"><Label htmlFor="agent-responsibilities">职责与关注点</Label><Textarea id="agent-responsibilities" required maxLength={1200} rows={3} value={editing.responsibilities} onChange={e=>setEditing({...editing,responsibilities:e.target.value})}/></div>
          <div className="space-y-2"><Label htmlFor="agent-greeting">开场白</Label><Textarea id="agent-greeting" required maxLength={300} rows={2} value={editing.greeting} onChange={e=>setEditing({...editing,greeting:e.target.value})}/></div>
          {creating&&<label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={activate} onChange={e=>setActivate(e.target.checked)}/>创建后设为该岗位的当前成员</label>}
          {notice&&<div role="alert" className="text-sm text-destructive">{notice}<Button type="button" variant="ghost" size="sm" disabled={loading} onClick={()=>void refresh()}>重新加载设置</Button></div>}
          <div className="flex flex-wrap justify-between gap-2 border-t pt-4"><Button type="button" variant="ghost" onClick={()=>{const original=config?.defaults?.agents.find(a=>a.role===editing.role);if(original)setEditing({...original,id:editing.id});}}><RotateCcw className="mr-2 h-3 w-3"/>恢复该岗位默认资料</Button><div className="flex gap-2"><Button type="button" variant="outline" onClick={()=>setEditing(undefined)}>取消</Button><Button type="submit">{saving?<Loader2 className="mr-2 h-4 w-4 animate-spin"/>:null}保存智能体</Button></div></div>
        </fieldset></form>}
      </DialogContent>
    </Dialog>
    <AlertDialog open={!!confirm} onOpenChange={open=>{if(!open&&!saving)setConfirm(undefined);}}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{confirm==='reset'?'恢复默认团队？':'删除这个智能体？'}</AlertDialogTitle><AlertDialogDescription>{confirm==='reset'?'将恢复六位默认伙伴的名字、头像、性格、职责和岗位安排，并移除自建智能体。历史对话与运行中的任务不会被改写。':'该成员未加入当前团队。删除后不会影响历史对话。'}</AlertDialogDescription></AlertDialogHeader>{notice&&<p role="alert" className="text-sm text-destructive">{notice}</p>}<AlertDialogFooter><AlertDialogCancel disabled={saving}>取消</AlertDialogCancel><Button disabled={saving} onClick={()=>void performConfirm()}>{saving?'正在保存…':confirm==='reset'?'恢复默认':'删除智能体'}</Button></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </div>;
}
