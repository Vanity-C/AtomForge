/**
 * Project dashboard: list, create and open projects.
 */
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Plus,
  Loader2,
  ArrowUp,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import ProjectGallery from '@/components/ProjectGallery';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { LoginGate, useAuth } from '@/components/AppShell';
import WorkspaceShell, {WORKSPACE_SECTIONS as SECTIONS, type WorkspaceSection as StudioSection} from '@/components/WorkspaceShell';
import { errorMessage, readToken } from '@/lib/sdk';
import {useProjects} from '@/hooks/useProjects';
import {
  createProject,
  deleteProject,
  loadProfile,
  type ProjectRecord,
} from '@/lib/projectStore';
import { suggestProjectName } from '@/lib/agent/codegen';
import { DEFAULT_PROFILE, type GenerationProfile } from '@/lib/agent/modelProvider';
import AgentPersona from '@/components/AgentPersona';
import StarterGallery from '@/components/StarterGallery';
import {useModeTeam,useAgents} from '@/components/AgentProvider';
import {teamRoster,activeGroup} from '@/lib/agentProfiles';
import AgentModeSwitch, {loadAgentMode,saveAgentMode} from '@/components/AgentModeSwitch';

export default function Dashboard() {
  const {config,loading:agentsLoading,error:agentsError}=useAgents();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { authState, user } = useAuth();
  const account = authState === 'authenticated' ? String(user?.id || '') : '';
  const activeAccount = useRef(account);
  activeAccount.current = account;
  const section = (SECTIONS.find(item=>item.id===searchParams.get('view'))?.id ?? 'home') as StudioSection;
  const promptQuery = searchParams.get('prompt');
  const focusOnHome = useRef(false);
  const selectSection = (next:StudioSection, focus=false) => {
    focusOnHome.current = focus;
    setSearchParams(previous=>{const params=new URLSearchParams(previous);if(next==='home')params.delete('view');else params.set('view',next);return params;});
    if(next==='home'&&section==='home'&&focus)composer.current?.focus();
  };

  const {projects, loading: listLoading, refreshing, error: listError, refresh} = useProjects(authState, user);
  const [prompt, setPrompt] = useState(searchParams.get('prompt') ?? '');
  const [creating, setCreating] = useState(false);
  const [agentMode,setAgentMode] = useState(loadAgentMode);
  const roster=teamRoster(useModeTeam(agentMode));
  const engineer=roster.find(member=>member.role==='engineer');
  useEffect(() => { setAgentMode(loadAgentMode(account)); }, [account]);
  const [profile, setProfile] = useState<GenerationProfile>(DEFAULT_PROFILE);
  const [pendingDelete, setPendingDelete] = useState<ProjectRecord | null>(null);
  const composer = useRef<HTMLTextAreaElement>(null);
  const contentPane = useRef<HTMLElement>(null);
  const draftKey = authState === 'authenticated' && user ? `atomforge:create-draft:${user.id}` : '';
  const [draftOwner, setDraftOwner] = useState('');
  const [draftSaved, setDraftSaved] = useState(false);
  useEffect(() => {
    if (!draftKey) { setDraftOwner(''); return; }
    let saved = '';
    try { saved = localStorage.getItem(draftKey) || ''; } catch { /* Storage may be unavailable. */ }
    setPrompt((promptQuery ?? saved).slice(0, 6000));
    setDraftOwner(draftKey);
  }, [draftKey, promptQuery]);
  useEffect(() => {
    if (!draftKey || draftOwner !== draftKey) return;
    try {
      if (prompt.trim()) localStorage.setItem(draftKey, prompt);
      else localStorage.removeItem(draftKey);
      setDraftSaved(!!prompt.trim());
    } catch { setDraftSaved(false); }
  }, [draftKey, draftOwner, prompt]);
  const fillIdea = (idea: string) => {
    const previous = prompt;
    setPrompt(idea);
    selectSection('home',true);
    toast.success('需求已填入，准备好后再开始创建', previous.trim() ? {
      action: {label:'撤销', onClick:()=>setPrompt(previous)},
    } : undefined);
  };

  useEffect(()=>{
    contentPane.current?.scrollTo({top:0,behavior:'instant'});
    if(section!=='home'||!focusOnHome.current)return;
    const timer=setTimeout(()=>{composer.current?.focus();focusOnHome.current=false;},0);
    return ()=>clearTimeout(timer);
  },[section]);

  // Load owned data only once the AtomForge session is resolved.
  useEffect(() => {
    if (authState === 'loading') return;
    setPendingDelete(null);
    setProfile(DEFAULT_PROFILE);
    if (authState === 'anonymous') {
      return;
    }
    let alive = true;
    const session = readToken();
    const current = () => alive && activeAccount.current === account && readToken() === session;
    loadProfile()
      .then(value => {if (current()) setProfile(value);})
      .catch(() => {if (current()) setProfile(DEFAULT_PROFILE);});
    return () => {alive = false;};
  }, [authState, account]);

  const handleCreate = async () => {
    if (creating) return;
    const instruction = prompt.trim();
    if (instruction.length < 4) {
      toast.error('请再具体一点', { description: '至少写清楚你想要什么应用，例如「做一个番茄钟」。' });
      return;
    }
    setCreating(true);
    try {
      const name = await suggestProjectName(instruction, profile);
      const project = await createProject({
        name,
        description: instruction.slice(0, 140),
        initialPrompt: instruction,
        agentMode,
      });
      setSearchParams({});
      try { localStorage.removeItem(draftKey); } catch { /* Creation remains available without storage. */ }
      setPrompt('');
      navigate(`/p/${project.id}?autostart=1`);
    } catch (error) {
      toast.error('创建项目失败', { description: errorMessage(error) });
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async () => {
    if (!pendingDelete) return;
    const target = pendingDelete;
    setPendingDelete(null);
    try {
      await deleteProject(target.id);
      toast.success(`已删除「${target.name}」`);
    } catch (error) {
      toast.error('删除失败', { description: errorMessage(error) });
    }
  };

  return (
    <WorkspaceShell authState={authState} user={user} contentRef={contentPane}
      onSelectSection={next=>selectSection(next,next==='home')}
      title={section==='home'?'你的个人工作室':SECTIONS.find(item=>item.id===section)?.label}
      headerAction={section!=='home'&&section!=='projects'&&<Button variant="ghost" size="sm" className="gap-2" onClick={()=>selectSection('home',true)}><Plus className="h-4 w-4"/>开启新项目</Button>}>

      {authState === 'loading' ? (
        <div className="mx-auto w-full max-w-screen-xl flex-1 px-4 py-10 sm:px-6 lg:px-8">
          <Skeleton className="h-52 w-full rounded-lg" />
          <Skeleton className="mt-10 h-6 w-32" />
        </div>
      ) : authState === 'anonymous' ? (
        <LoginGate
          title="登录后即可创建项目"
          description="你的项目、代码与对话记录都会保存在自己的账号下，随时回来继续迭代。"
        />
      ) : (
        <>
            {section==='home'&&<section className="conversation-home" aria-label="开始新项目">
              <div className="conversation-welcome">
                <div className="conversation-team" aria-label="你的智能体伙伴">{!config&&(agentsLoading||agentsError)?<span className="text-sm text-muted-foreground">{agentsError?'协作成员暂未加载，请稍后重试':'正在加载你的智能体…'}</span>:roster.map(r=><AgentPersona key={r.id} role={r.id} profile={r.profile} avatarClassName="h-12 w-12"/>)}</div>
                <h1>今天，想把什么想法变成现实？</h1>
                <p>{agentMode==='team'?`从一句话开始，和${config?activeGroup(config).name:'你的协作团队'}一起，做出点不一样的。`:'从一句话开始，让应用工程师独立完成规划、实现和自测。'}</p>
                <div className="conversation-input-card">
                  <Textarea ref={composer} aria-label="描述你想要的应用" value={prompt} maxLength={6000} onChange={e=>setPrompt(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&(e.ctrlKey||e.metaKey)&&!e.nativeEvent.isComposing){e.preventDefault();if(!creating&&prompt.trim().length>=4)void handleCreate();}}} disabled={creating} placeholder="说说你的想法，或者，你想解决什么问题…" className="conversation-input"/>
                  <div className="conversation-input-tools"><AgentModeSwitch compact value={agentMode} disabled={creating} onChange={mode=>{setAgentMode(mode);saveAgentMode(mode,account);}}/><div className="conversation-send-group"><span>{prompt.length?`${prompt.length} / 6000`:'Ctrl / ⌘ + Enter'}</span><Button size="icon" className="conversation-send" disabled={creating||prompt.trim().length<4} aria-label={creating?'正在创建项目':'发送需求并创建项目'} title="发送需求并创建项目" onClick={handleCreate}>{creating?<Loader2 className="h-5 w-5 animate-spin"/>:<ArrowUp className="h-5 w-5"/>}</Button></div></div>
                </div>
                <div className="conversation-composer-note"><span>{agentMode==='team'?'团队一起推敲方案，关键决定由你确认。':`${engineer?.alias||'开发伙伴'} 会负责规划、实现和检查。`}</span>{draftSaved&&<span>草稿已保存</span>}</div>
              </div>
            </section>}
            {section!=='home'&&<div className="conversation-section-content" key={section}>
            {section==='projects'&&<ProjectGallery key={account} projects={projects} loading={listLoading} refreshing={refreshing} error={listError} userId={account} onRefresh={refresh} onCreate={()=>selectSection('home',true)} onDelete={setPendingDelete}/>}
            {section==='inspiration'&&<StarterGallery onUse={fillIdea} disabled={creating}/>}
            {section==='notes'&&<section id="getting-started" aria-label="使用帮助">
            <h1 className="text-3xl font-semibold">创作小贴士</h1>
            <p className="mt-1 text-sm text-muted-foreground">从第一句话到第一版应用。</p>
            <div className="mt-6 divide-y border-y">{[
              ['第一次创建，应该怎么描述？','说清楚给谁用、解决什么问题，以及最重要的两三个操作。例如：给自己用的记账本，可以新增支出、按月筛选，刷新后保留记录。也可以先试用侧边栏中的灵感示例，再修改示例需求。'],
              ['工程师和团队模式怎么选择？','简单明确的需求可以交给开发伙伴；需要先讨论方案时选择团队模式，产品伙伴会组织需求梳理、设计、开发与验收，只在必要决策时请你确认。模式在创建项目时确定，之后保持固定；每次创建都有独立的对话和代码。'],
              ['团队向我确认时，可以慢一点吗？','可以。确认卡默认给你 30 秒选择推荐方案；点击选项或填写想法会暂停倒计时，也可以点“继续思考”后再决定。选择“其他”可填写自己的方案，确认后团队会据此继续。'],
              ['刷新页面后，内容会丢吗？','首页需求草稿保留在当前浏览器，并按账号区分；创建成功后会清空。项目的对话、代码和版本保存到服务端，登录后可继续。灵感库的试用数据只保留到关闭预览。'],
              ['如何查看和分享做好的应用？','打开项目工作台，在右侧标签页查看预览、文件和工作看板。生成完成后可体验应用、继续提出修改，或使用工作台的分享功能。外部访问需要部署地址能够从公网访问，本地地址仅适用于当前电脑。'],
            ].map(([question,answer])=><details key={question} className="group py-4"><summary className="cursor-pointer text-sm font-medium focus-visible:outline-primary">{question}</summary><p className="mt-3 max-w-3xl text-sm leading-7 text-muted-foreground">{answer}</p></details>)}</div>
          </section>}
            </div>}
        </>
      )}

      <AlertDialog open={!!pendingDelete} onOpenChange={(open) => !open && setPendingDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除「{pendingDelete?.name}」？</AlertDialogTitle>
            <AlertDialogDescription>
              项目的代码、版本历史和对话记录都会被永久删除，此操作无法撤销。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>保留项目</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={handleDelete}
            >
              删除项目
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </WorkspaceShell>
  );
}
