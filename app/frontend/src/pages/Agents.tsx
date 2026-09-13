import {useEffect,useRef,useState,type FormEvent} from 'react';
import {ArrowRight,ArrowUpRight,Check,CheckCheck,Copy,Layers3,Loader2,Plus,RotateCcw,Search,Sparkles,Trash2,Upload,Users,X} from 'lucide-react';
import {toast} from 'sonner';
import {LoginGate,useAuth} from '@/components/AppShell';
import WorkspaceShell from '@/components/WorkspaceShell';
import {useAgents} from '@/components/AgentProvider';
import AgentAvatar from '@/components/AgentAvatar';
import AgentIntroduction from '@/components/AgentIntroduction';
import StudioSelect from '@/components/StudioSelect';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Textarea} from '@/components/ui/textarea';
import {Label} from '@/components/ui/label';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import {AlertDialog,AlertDialogContent,AlertDialogHeader,AlertDialogTitle,AlertDialogDescription,AlertDialogFooter,AlertDialogCancel} from '@/components/ui/alert-dialog';
import {ROLE_LABELS,type AgentProfile,type AgentRole,type AgentConfiguration,type AgentGroup} from '@/lib/agentProfiles';
import {errorMessage} from '@/lib/sdk';
import './agents.css';

const ROLES=Object.keys(ROLE_LABELS) as AgentRole[];
const COLORS=[{id:'sage',label:'苔绿'},{id:'sky',label:'晴蓝'},{id:'violet',label:'鸢尾'},{id:'amber',label:'暖杏'},{id:'rose',label:'蔷薇'},{id:'slate',label:'岩灰'}] as const;
type Confirmation={kind:'team'|'agent';id:string;name:string}|{kind:'defaults'};
function matchesAgent(person:AgentProfile,query:string){return `${person.name} ${person.title} ${ROLE_LABELS[person.role]} ${person.personality} ${person.responsibilities}`.toLowerCase().includes(query.trim().toLowerCase());}
function Members({members}:{members:AgentProfile[]}){return <div className="crew-avatar-stack">{members.slice(0,6).map(person=><AgentAvatar key={person.id} role={person.role} person={person} className="crew-stack-avatar"/>)}{members.length>6&&<span className="crew-stack-more">+{members.length-6}</span>}</div>;}

export default function Agents(){
  const {authState,user}=useAuth();
  const {config,loading,error,refresh,save}=useAgents();
  const [tab,setTab]=useState<'teams'|'agents'>('teams');
  const [query,setQuery]=useState('');
  const [roleFilter,setRoleFilter]=useState<AgentRole|'all'>('all');
  const [editing,setEditing]=useState<AgentProfile>();
  const [creatingAgent,setCreatingAgent]=useState(false);
  const [groupDraft,setGroupDraft]=useState<AgentGroup>();
  const [creatingGroup,setCreatingGroup]=useState(false);
  const [memberQuery,setMemberQuery]=useState('');
  const [saving,setSaving]=useState(false);
  const [reading,setReading]=useState(false);
  const [notice,setNotice]=useState('');
  const [confirm,setConfirm]=useState<Confirmation>();
  const file=useRef<HTMLInputElement>(null);
  const account=authState==='authenticated'?String(user?.id??''):'';
  const activeAccount=useRef(account);
  activeAccount.current=account;
  useEffect(()=>{
    setEditing(undefined);setGroupDraft(undefined);setConfirm(undefined);
    setNotice('');setQuery('');setMemberQuery('');setRoleFilter('all');
    setSaving(false);setReading(false);
  },[account]);
  const groups=config?.teams??[],agents=config?.agents??[];
  const currentGroup=groups.find(group=>group.id===config?.active_team_id)??groups[0];
  const membersOf=(group?:AgentGroup)=>(group?.member_ids??[]).map(id=>agents.find(person=>person.id===id)).filter((person):person is AgentProfile=>!!person).sort((a,b)=>Number(b.role==='leader')-Number(a.role==='leader'));
  const currentMembers=membersOf(currentGroup);
  const isDefaultGroup=groupDraft?.id==='default-team';
  const references=editing?groups.filter(group=>group.member_ids.includes(editing.id)):[];
  const matchedGroups=groups.filter(group=>`${group.name} ${group.description} ${membersOf(group).map(a=>a.name).join(' ')}`.toLowerCase().includes(query.trim().toLowerCase()));
  const matchedAgents=agents.filter(agent=>(roleFilter==='all'||agent.role===roleFilter)&&matchesAgent(agent,query));
  const availableMembers=agents.filter(person=>matchesAgent(person,memberQuery));
  async function persist(value:AgentConfiguration,message:string){
    const owner=account;
    setSaving(true);setNotice('');
    try{await save(value);if(activeAccount.current!==owner)return false;toast.success(message);return true;}
    catch(cause){if(activeAccount.current===owner)setNotice(errorMessage(cause));return false;}
    finally{if(activeAccount.current===owner)setSaving(false);}
  }
  function editAgent(agent:AgentProfile,isNew=false){setEditing({...agent});setCreatingAgent(isNew);setNotice('');}
  function createAgent(){const base=config?.defaults?.agents.find(agent=>agent.role==='engineer');if(base)editAgent({...base,id:crypto.randomUUID(),name:'我的伙伴',greeting:'你好，把你的想法告诉我，我们一起把它做成作品。'},true);}
  function editGroup(group?:AgentGroup,duplicate=false){
    setNotice('');setMemberQuery('');setCreatingGroup(!group||duplicate);
    setGroupDraft(group?{...group,id:duplicate?crypto.randomUUID():group.id,name:duplicate?`${group.name.slice(0,30)} · 副本`:group.name,member_ids:[...group.member_ids]}:{id:crypto.randomUUID(),name:'',description:'',color:'sage',member_ids:[]});
  }
  async function submitGroup(event:FormEvent){
    event.preventDefault();if(!config||!groupDraft||saving)return;
    const teams=creatingGroup?[...groups,groupDraft]:groups.map(group=>group.id===groupDraft.id?groupDraft:group);
    if(await persist({...config,teams},creatingGroup?'新团队已创建':'团队已更新'))setGroupDraft(undefined);
  }
  async function submitAgent(event:FormEvent){
    event.preventDefault();if(!config||!editing||saving||reading)return;
    const next=creatingAgent?[...agents,editing]:agents.map(agent=>agent.id===editing.id?editing:agent);
    if(await persist({...config,agents:next},creatingAgent?'新伙伴已加入智能体库':'智能体资料已保存'))setEditing(undefined);
  }
  function toggleMember(id:string){
    if(!groupDraft)return;const selected=groupDraft.member_ids.includes(id);
    if(!selected&&groupDraft.member_ids.length>=12){setNotice('每支团队最多选择 12 位伙伴');return;}
    setNotice('');setGroupDraft({...groupDraft,member_ids:selected?groupDraft.member_ids.filter(member=>member!==id):[...groupDraft.member_ids,id]});
  }
  async function upload(image?:File){
    if(!image||!editing)return;
    const owner=account,agentId=editing.id;
    if(!['image/png','image/jpeg','image/webp'].includes(image.type)||image.size>1024*1024){setNotice('请选择不超过 1 MB 的 PNG、JPG 或 WebP 图片');return;}
    setReading(true);setNotice('');
    try{const value=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=reject;reader.readAsDataURL(image);});if(activeAccount.current===owner)setEditing(previous=>previous?.id===agentId?{...previous,avatar:value}:previous);}
    catch{if(activeAccount.current===owner)setNotice('图片读取失败，请重新选择');}finally{if(activeAccount.current===owner)setReading(false);}
  }
  async function performConfirm(){
    if(!config||!confirm)return;let next:AgentConfiguration;
    if(confirm.kind==='team')next={...config,teams:groups.filter(group=>group.id!==confirm.id),active_team_id:config.active_team_id===confirm.id?'default-team':config.active_team_id};
    else if(confirm.kind==='agent')next={...config,agents:agents.filter(agent=>agent.id!==confirm.id)};
    else next={...config,agents:agents.map(agent=>config.defaults?.agents.find(original=>original.id===agent.id)??agent)};
    if(await persist(next,confirm.kind==='defaults'?'默认伙伴资料已恢复':'已删除')){setConfirm(undefined);setEditing(undefined);setGroupDraft(undefined);}
  }
  const changeTab=(value:'teams'|'agents')=>{setTab(value);setQuery('');};

  return <WorkspaceShell authState={authState} user={user} className="crew-root">
    {authState==='anonymous'?<LoginGate title="让你的想法，遇见一支好团队" description="创建专属智能体，按自己的工作方式组队。每一支团队都只属于你。"/>:<div className="crew-page">
      <header className="crew-hero"><div className="crew-hero-copy"><span className="crew-eyebrow"><span/>我的团队</span><h1>把不同的天赋，<br/><span>组成你的团队。</span></h1><p>给每一种想法，找到合适的伙伴。<br className="hidden sm:block"/>自由组队，让你喜欢的工作方式成为默契。</p><div className="crew-metrics"><span><strong>{String(groups.length).padStart(2,'0')}</strong>支团队</span><i/><span><strong>{String(agents.length).padStart(2,'0')}</strong>位伙伴</span><span className="crew-metrics-note">为下一次创造准备就绪</span></div></div>
        <div className="crew-spotlight"><div className="crew-spotlight-orbit" aria-hidden="true"/><div className="crew-spotlight-top"><span><i className="crew-live-dot"/>当前协作团队</span><Layers3 size={18}/></div><h2>{currentGroup?.name??'正在寻找你的伙伴…'}</h2><p>{currentGroup?.description||'从一个想法出发，一起把它变成作品。'}</p><div className="crew-spotlight-members">{currentMembers.slice(0,6).map(person=><button key={person.id} type="button" disabled={saving} onClick={()=>editAgent(person)} aria-label={`编辑${person.name}的资料`}><AgentAvatar role={person.role} person={person} className="crew-hero-avatar"/><span>{person.name}</span></button>)}{currentMembers.length>6&&<span className="crew-spotlight-extra">+{currentMembers.length-6}</span>}</div><div className="crew-spotlight-bottom"><span>新任务将由这支团队协作</span><span>{currentMembers.length} 位伙伴<ArrowUpRight size={15}/></span></div></div>
      </header>
      <div className="crew-toolbar"><div className="crew-tabs" role="tablist" aria-label="团队与智能体">{([{id:'teams',label:'我的团队',count:groups.length},{id:'agents',label:'智能体库',count:agents.length}] as const).map(item=><button id={`${item.id}-tab`} key={item.id} type="button" role="tab" aria-selected={tab===item.id} aria-controls={`${item.id}-panel`} tabIndex={tab===item.id?0:-1} onClick={()=>changeTab(item.id)} onKeyDown={event=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(event.key)){event.preventDefault();const next=event.key==='Home'?'teams':event.key==='End'?'agents':tab==='teams'?'agents':'teams';changeTab(next);document.getElementById(`${next}-tab`)?.focus();}}}>{item.label}<span>{item.count}</span></button>)}</div><div className="crew-toolbar-actions"><label className="crew-search"><Search size={16}/><input aria-label={tab==='teams'?'搜索团队':'搜索智能体'} value={query} onChange={event=>setQuery(event.target.value)} placeholder={tab==='teams'?'搜索团队或伙伴':'搜索名字或专长'}/>{query&&<button type="button" aria-label="清除搜索" onClick={()=>setQuery('')}><X size={14}/></button>}</label><Button className="crew-primary" disabled={!config||saving||(tab==='teams'?groups.length>=12:agents.length>=24)} onClick={()=>tab==='teams'?editGroup():createAgent()}><Plus size={16}/>{tab==='teams'?'新建团队':'新建智能体'}</Button></div></div>
      {((notice&&!editing&&!groupDraft)||error)&&<div className="crew-notice" role="alert"><span>{error||notice}</span><Button variant="ghost" size="sm" disabled={loading||saving} onClick={()=>void refresh()}>重新加载</Button></div>}
      {!config?<div className="crew-loading" role="status"><Loader2 className="animate-spin" size={22}/>{loading?'正在加载你的工作室…':'暂时无法加载团队，请重试。'}</div>:tab==='teams'?<section id="teams-panel" role="tabpanel" aria-labelledby="teams-tab">
        <div className="crew-section-intro"><p>为不同的想法，准备不同的阵容。</p><span>切换团队只影响新任务</span></div><div className="crew-team-grid">{matchedGroups.map(group=>{
          const members=membersOf(group),selected=group.id===config.active_team_id,isDefault=group.id==='default-team';
          return <article className={`crew-team-card ${selected?'is-current':''}`} data-color={group.color} key={group.id}><button type="button" className="crew-team-open" disabled={saving} onClick={()=>editGroup(group)} aria-label={`编辑团队：${group.name}`}><div className="crew-team-card-top"><span className="crew-team-symbol"><Layers3 size={21}/></span><span className={`crew-team-status ${selected?'is-current':''}`}>{selected?<><CheckCheck size={13}/>当前使用</>:isDefault?'默认团队':'自建团队'}</span></div><h3>{group.name}</h3><p className="crew-team-description">{group.description||'一支由你亲手组成的团队，准备好迎接下一个想法。'}</p><Members members={members}/><div className="crew-team-skills">{[...new Set(members.map(person=>person.role))].map(role=><span key={role}>{ROLE_LABELS[role]}</span>)}</div></button><footer><span>{members.length} 位伙伴{isDefault&&<span className="crew-default-label"> · 默认团队</span>}</span><div><button type="button" className="crew-icon-action" aria-label={`复制团队：${group.name}`} title="复制团队" disabled={saving||groups.length>=12} onClick={()=>editGroup(group,true)}><Copy size={15}/></button>{selected?<span className="crew-current-label"><i/>已就位</span>:<button type="button" className="crew-use-team" disabled={saving} onClick={()=>void persist({...config,active_team_id:group.id},`已切换到「${group.name}」`)}>使用团队<ArrowRight size={15}/></button>}</div></footer></article>;
        })}{!query&&groups.length<12&&<button type="button" className="crew-new-team" disabled={saving} onClick={()=>editGroup()}><span className="crew-new-icon"><Plus size={26}/></span><strong>下一支团队，由你定义</strong><span>选上合拍的伙伴，开始新的协作。</span><span className="crew-new-link">组建团队<ArrowUpRight size={16}/></span></button>}</div>
        {!matchedGroups.length&&query&&<div className="crew-empty"><Search size={30}/><h3>还没有找到这支团队</h3><p>试试其他名字，或创建一支新的团队。</p><Button variant="outline" onClick={()=>setQuery('')}>查看全部团队</Button></div>}
        <div className="crew-library-callout"><span className="crew-callout-icon"><Sparkles size={20}/></span><div><strong>好团队，从有个性的伙伴开始。</strong><p>给智能体一个名字、一种性格，和它擅长的事。</p></div><button type="button" onClick={()=>changeTab('agents')}>探索智能体库<ArrowRight size={16}/></button></div>
      </section>:<section id="agents-panel" role="tabpanel" aria-labelledby="agents-tab"><div className="crew-agent-filters"><div role="group" aria-label="筛选智能体岗位">{(['all',...ROLES] as const).map(role=><button key={role} type="button" aria-pressed={roleFilter===role} onClick={()=>setRoleFilter(role)}>{role==='all'?'全部伙伴':ROLE_LABELS[role]}</button>)}</div><span>点击卡片，认识并编辑这位伙伴</span></div><div className="crew-agent-grid">{matchedAgents.map(agent=>{
        const usage=groups.filter(group=>group.member_ids.includes(agent.id)).length;
        // Anchor the introduction to the whole card. A second avatar trigger
        // would close and reopen it when the floating text overlaps the card.
        return <AgentIntroduction key={agent.id} person={agent} side="right">
          <button type="button" className="crew-agent-card" data-role={agent.role} disabled={saving} onClick={()=>editAgent(agent)} aria-label={`编辑智能体：${agent.name}`}>
            <div className="crew-agent-cover"><span className="crew-agent-role">{ROLE_LABELS[agent.role]}</span><ArrowUpRight className="crew-agent-arrow" size={18}/><AgentAvatar role={agent.role} person={agent} className="crew-portrait" showIntroduction={false}/></div>
            <div className="crew-agent-info"><div className="crew-agent-name"><h3>{agent.name}</h3>{agent.id.startsWith('default-')&&<span>默认伙伴</span>}</div><p className="crew-agent-title">{agent.title}</p><p className="crew-agent-greeting">{agent.greeting}</p><div className="crew-agent-expertise"><span>擅长</span><p>{agent.responsibilities}</p></div><footer><span><Users size={13}/>{usage?`正在 ${usage} 支团队中协作`:'等待加入一支团队'}</span><span className="crew-agent-edit-hint">认识我<ArrowRight size={14}/></span></footer></div>
          </button>
        </AgentIntroduction>;
      })}</div>{!matchedAgents.length&&<div className="crew-empty"><Search size={30}/><h3>暂时没有找到合适的伙伴</h3><p>换一个关键词，或创建一位专属智能体。</p><Button variant="outline" onClick={()=>{setQuery('');setRoleFilter('all');}}>查看全部伙伴</Button></div>}<div className="crew-library-bottom"><span>一位伙伴可以加入多支团队，资料修改会应用到之后的新任务。</span><button type="button" disabled={saving} onClick={()=>{setNotice('');setConfirm({kind:'defaults'});}}><RotateCcw size={13}/>恢复默认伙伴资料</button></div></section>}
    </div>}

    <Dialog open={!!groupDraft} onOpenChange={open=>{if(!open&&!saving)setGroupDraft(undefined);}}><DialogContent className="crew-dialog crew-group-dialog" onInteractOutside={event=>{if(saving)event.preventDefault();}} onEscapeKeyDown={event=>{if(saving)event.preventDefault();}}><DialogHeader><span className="crew-dialog-kicker"><Users size={15}/>{creatingGroup?'新的默契，从这里开始':'让阵容更合拍'}</span><DialogTitle>{isDefaultGroup?'编辑默认团队':creatingGroup?'组建你的团队':'编辑团队'}</DialogTitle><DialogDescription>选择 1–12 位伙伴。可以跨岗位组合，也可以让同一专长的成员并肩协作。</DialogDescription></DialogHeader>
      {groupDraft&&<form onSubmit={submitGroup} className="crew-group-form"><fieldset disabled={saving}>
        <div className="crew-group-details"><div><Label htmlFor="team-name">团队名称</Label><Input id="team-name" required maxLength={60} placeholder="例如：灵感实验室" value={groupDraft.name} onChange={event=>setGroupDraft({...groupDraft,name:event.target.value})}/></div><div><Label htmlFor="team-description">一句话介绍 <span className="crew-optional">可选</span></Label><Input id="team-description" maxLength={300} placeholder="这支团队擅长什么，准备一起做什么？" value={groupDraft.description} onChange={event=>setGroupDraft({...groupDraft,description:event.target.value})}/></div></div><div className="crew-palette" role="group" aria-label="团队主题色"><span>团队颜色</span>{COLORS.map(color=><button type="button" key={color.id} data-color={color.id} aria-label={color.label} aria-pressed={groupDraft.color===color.id} onClick={()=>setGroupDraft({...groupDraft,color:color.id})}>{groupDraft.color===color.id&&<Check size={14}/>}</button>)}</div>
        <div className="crew-member-selection-title"><h3>团队伙伴<span>{groupDraft.member_ids.length} / 12</span></h3><span>按选择顺序加入团队</span></div>
        {!!groupDraft.member_ids.length&&<div className="crew-selected-members">{membersOf(groupDraft).map(person=><button type="button" key={person.id} onClick={()=>toggleMember(person.id)} aria-label={`移除${person.name}`}><AgentAvatar person={person} role={person.role} className="h-6 w-6"/><span>{person.name}</span><X size={12}/></button>)}</div>}
        <label className="crew-search crew-member-search"><Search size={15}/><input aria-label="搜索可选伙伴" placeholder="搜索智能体名字、岗位或专长" value={memberQuery} onChange={event=>setMemberQuery(event.target.value)}/>{memberQuery&&<button type="button" aria-label="清除伙伴搜索" onClick={()=>setMemberQuery('')}><X size={14}/></button>}</label>
        <div className="crew-member-picker">{availableMembers.map(person=>{const selected=groupDraft.member_ids.includes(person.id);return <button type="button" key={person.id} className={`crew-member-option ${selected?'is-selected':''}`} aria-pressed={selected} disabled={!selected&&groupDraft.member_ids.length>=12} onClick={()=>toggleMember(person.id)}><AgentAvatar role={person.role} person={person} className="h-11 w-11"/><span><strong>{person.name}</strong><small>{person.title}</small></span><span className="crew-choice-mark">{selected?<Check size={14}/>:<Plus size={14}/>}</span></button>;})}</div>
        {!availableMembers.length&&<p className="crew-member-empty" role="status">没有找到匹配的智能体，试试其他名字或专长。</p>}
        <p className="crew-coverage-note">未单独配置的岗位会由已选伙伴承接；运行中的任务会保留开始时的阵容。</p>{notice&&<p role="alert" className="crew-form-error">{notice}</p>}
        <div className="crew-dialog-footer">{!creatingGroup&&!isDefaultGroup?<Button type="button" variant="ghost" className="crew-danger" onClick={()=>{setNotice('');setConfirm({kind:'team',id:groupDraft.id,name:groupDraft.name});}}><Trash2 size={15}/>删除团队</Button>:<span/>}<div><Button type="button" variant="outline" onClick={()=>setGroupDraft(undefined)}>取消</Button><Button type="submit" className="crew-primary" disabled={!groupDraft.name.trim()||!groupDraft.member_ids.length}>{saving?<Loader2 className="animate-spin" size={15}/>:<Check size={15}/>} {creatingGroup?'创建团队':'保存团队'}</Button></div></div>
      </fieldset></form>}
    </DialogContent></Dialog>

    <Dialog open={!!editing} onOpenChange={open=>{if(!open&&!saving&&!reading)setEditing(undefined);}}><DialogContent className="crew-dialog crew-profile-dialog" onInteractOutside={event=>{if(saving||reading)event.preventDefault();}} onEscapeKeyDown={event=>{if(saving||reading)event.preventDefault();}}><DialogHeader><span className="crew-dialog-kicker"><Sparkles size={15}/>每一位伙伴，都可以与众不同</span><DialogTitle>{creatingAgent?'认识你的新伙伴':`${editing?.name}的智能体资料`}</DialogTitle><DialogDescription>名字、性格与专长会影响真实协作。新任务会使用更新后的资料。</DialogDescription></DialogHeader>
      {editing&&<form onSubmit={submitAgent}><fieldset disabled={saving||reading} className="crew-profile-form"><div className="crew-profile-identity"><AgentAvatar role={editing.role} person={editing} className="h-24 w-24"/><div><Label>伙伴头像</Label><div className="crew-avatar-options" aria-label="内置头像选择">{ROLES.map(role=><button type="button" key={role} aria-label={`${ROLE_LABELS[role]}风格头像`} aria-pressed={!editing.avatar&&editing.avatar_style===role} onClick={()=>setEditing({...editing,avatar:'',avatar_style:role})}><AgentAvatar role={role} person={{...editing,avatar:'',avatar_style:role}} className="h-8 w-8"/></button>)}</div><button type="button" className="crew-upload" onClick={()=>file.current?.click()}><Upload size={13}/>{reading?'读取中…':'上传自己的头像'}<span>PNG / JPG / WebP · 1 MB 内</span></button><input ref={file} aria-label="选择智能体头像" type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={event=>{void upload(event.target.files?.[0]);event.target.value='';}}/></div></div>
        <div className="crew-form-columns"><div><Label htmlFor="agent-name">名字</Label><Input id="agent-name" required maxLength={40} value={editing.name} onChange={event=>setEditing({...editing,name:event.target.value})}/></div><div><Label htmlFor="agent-title">职责名称</Label><Input id="agent-title" required maxLength={60} value={editing.title} onChange={event=>setEditing({...editing,title:event.target.value})}/></div></div>
        <div><Label htmlFor="agent-role">擅长的岗位</Label><StudioSelect id="agent-role" aria-label="擅长的岗位" disabled={!creatingAgent} value={editing.role} onValueChange={value=>setEditing({...editing,role:value as AgentRole})} options={ROLES.map(role=>({value:role,label:ROLE_LABELS[role]}))}/></div>
        {([{key:'personality',label:'性格与表达方式',max:1000,rows:3},{key:'responsibilities',label:'职责与关注点',max:1200,rows:3},{key:'greeting',label:'开场白',max:300,rows:2}] as const).map(field=><div key={field.key}><Label htmlFor={`agent-${field.key}`}>{field.label}</Label><Textarea id={`agent-${field.key}`} required maxLength={field.max} rows={field.rows} value={editing[field.key]} onChange={event=>setEditing({...editing,[field.key]:event.target.value})}/></div>)}
        {!creatingAgent&&<div className="crew-profile-teams"><Users size={15}/><span>{references.length?`正在「${references.map(group=>group.name).join('」「')}」中协作`:'还没有加入团队，可以在团队设置中选择这位伙伴。'}</span></div>}
        {notice&&<div role="alert" className="crew-form-error">{notice}<Button type="button" variant="ghost" size="sm" disabled={loading} onClick={()=>void refresh()}>重新加载设置</Button></div>}
        <div className="crew-profile-utilities"><button type="button" onClick={()=>{const original=config?.defaults?.agents.find(agent=>agent.role===editing.role);if(original)setEditing({...original,id:editing.id});}}><RotateCcw size={13}/>恢复该岗位默认资料</button>{!creatingAgent&&!editing.id.startsWith('default-')&&<button type="button" className="crew-danger" disabled={references.length>0} title={references.length?'先将伙伴从所有团队中移除，再删除':'删除智能体'} onClick={()=>{setNotice('');setConfirm({kind:'agent',id:editing.id,name:editing.name});}}><Trash2 size={13}/>删除智能体</button>}</div>
        <div className="crew-dialog-footer"><span className="crew-save-note">{creatingAgent?'创建后可加入任意团队':'不会改写历史对话'}</span><div><Button type="button" variant="outline" onClick={()=>setEditing(undefined)}>取消</Button><Button type="submit" className="crew-primary">{saving&&<Loader2 className="animate-spin" size={15}/>}保存智能体</Button></div></div>
      </fieldset></form>}
    </DialogContent></Dialog>
    <AlertDialog open={!!confirm} onOpenChange={open=>{if(!open&&!saving)setConfirm(undefined);}}><AlertDialogContent className="crew-dialog"><AlertDialogHeader><AlertDialogTitle>{confirm?.kind==='defaults'?'恢复六位默认伙伴的资料？':`删除「${confirm?.name??''}」？`}</AlertDialogTitle><AlertDialogDescription>{confirm?.kind==='defaults'?'将还原默认伙伴的名字、头像、性格与职责。你创建的智能体和团队都会保留，历史对话不会改变。':confirm?.kind==='team'?'智能体会保留在智能体库中。若删除当前团队，将自动切回默认团队；运行中的任务不受影响。':'这位伙伴未被任何团队使用。删除不会影响已有对话和历史任务。'}</AlertDialogDescription></AlertDialogHeader>{notice&&<p role="alert" className="crew-form-error">{notice}</p>}<AlertDialogFooter><AlertDialogCancel disabled={saving}>取消</AlertDialogCancel><Button className={confirm?.kind==='defaults'?'crew-primary':'crew-delete-confirm'} disabled={saving} onClick={()=>void performConfirm()}>{saving?'正在保存…':confirm?.kind==='defaults'?'恢复资料':'确认删除'}</Button></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </WorkspaceShell>;
}
