/**
 * Project dashboard: list, create and open projects.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import '@/styles/conversation-studio.css';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  ArrowUpRight,
  Clock,
  Plus,
  Globe,
  Layers,
  Loader2,
  ArrowUp,
  Home,
  FolderOpen,
  Lightbulb,
  BookOpen,
  PanelLeftClose,
  PanelLeftOpen,
  Users,
  Settings2,
  MessageSquare,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
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
import { AccountMenu, BrandMark, LoginGate, TopBar, useAuth } from '@/components/AppShell';
import { errorMessage } from '@/lib/sdk';
import {
  createProject,
  deleteProject,
  listProjects,
  loadProfile,
  type ProjectRecord,
} from '@/lib/projectStore';
import { suggestProjectName } from '@/lib/agent/codegen';
import { DEFAULT_PROFILE, type GenerationProfile } from '@/lib/agent/modelProvider';
import AgentPersona from '@/components/AgentPersona';
import StarterGallery from '@/components/StarterGallery';
import {useTeam} from '@/components/AgentProvider';
import AgentModeSwitch, {loadAgentMode,saveAgentMode} from '@/components/AgentModeSwitch';

const SECTIONS = [
  {id:'home', label:'开启新项目', Icon:Home},
  {id:'projects', label:'我的项目', Icon:FolderOpen},
  {id:'inspiration', label:'灵感', Icon:Lightbulb},
  {id:'notes', label:'创作小贴士', Icon:BookOpen},
] as const;
type StudioSection = typeof SECTIONS[number]['id'];

function relativeTime(value?: string): string {
  if (!value) return '刚刚';
  const then = new Date(value).getTime();
  if (Number.isNaN(then)) return '刚刚';
  const diff = Date.now() - then;
  const minute = 60_000;
  if (diff < minute) return '刚刚';
  if (diff < 60 * minute) return `${Math.floor(diff / minute)} 分钟前`;
  if (diff < 24 * 60 * minute) return `${Math.floor(diff / (60 * minute))} 小时前`;
  if (diff < 30 * 24 * 60 * minute) return `${Math.floor(diff / (24 * 60 * minute))} 天前`;
  return new Date(value).toLocaleDateString('zh-CN');
}

export default function Dashboard() {
  const TEAM_ROLES=useTeam();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { authState, user } = useAuth();
  const section = (SECTIONS.find(item=>item.id===searchParams.get('view'))?.id ?? 'home') as StudioSection;
  const promptQuery = searchParams.get('prompt');
  const [collapsed,setCollapsed] = useState(()=>{try{return localStorage.getItem('atomforge:sidebar-collapsed')==='true';}catch{return false;}});
  const focusOnHome = useRef(false);
  const selectSection = (next:StudioSection, focus=false) => {
    focusOnHome.current = focus;
    setSearchParams(previous=>{const params=new URLSearchParams(previous);if(next==='home')params.delete('view');else params.set('view',next);return params;});
    if(next==='home'&&section==='home'&&focus)composer.current?.focus();
  };
  const toggleSidebar = () => {
    setCollapsed(previous=>{const next=!previous;try{localStorage.setItem('atomforge:sidebar-collapsed',String(next));}catch{/* Layout remains usable without storage. */}return next;});
  };

  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState('');
  const [prompt, setPrompt] = useState(searchParams.get('prompt') ?? '');
  const [creating, setCreating] = useState(false);
  const [agentMode,setAgentMode] = useState(loadAgentMode);
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

  const refresh = useCallback(async () => {
    setListLoading(true);
    setListError('');
    try {
      setProjects(await listProjects());
    } catch (error) {
      setListError(errorMessage(error, '项目列表加载失败'));
    } finally {
      setListLoading(false);
    }
  }, []);

  // Load owned data only once the AtomForge session is resolved.
  useEffect(() => {
    if (authState === 'loading') return;
    if (authState === 'anonymous') {
      setProjects([]);
      setListLoading(false);
      return;
    }
    refresh();
    loadProfile()
      .then(setProfile)
      .catch(() => setProfile(DEFAULT_PROFILE));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authState]);

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
    setProjects((prev) => prev.filter((p) => p.id !== target.id));
    try {
      await deleteProject(target.id);
      toast.success(`已删除「${target.name}」`);
    } catch (error) {
      toast.error('删除失败', { description: errorMessage(error) });
      refresh();
    }
  };

  return (
    <div className={authState==='authenticated'?`conversation-studio ${collapsed?'sidebar-collapsed':''}`:'flex min-h-screen flex-col bg-background'}>
      {authState!=='authenticated'&&<TopBar authState={authState} user={user} brandTo="/dashboard"/>}

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
          <aside className="conversation-sidebar" aria-label="工作室侧边栏">
            <div className="sidebar-brand-row"><BrandMark to="/dashboard"/><Button variant="ghost" size="icon" className="sidebar-toggle" aria-label={collapsed?'展开侧边栏':'折叠侧边栏'} aria-expanded={!collapsed} aria-controls="studio-navigation" title={collapsed?'展开侧边栏':'折叠侧边栏'} onClick={toggleSidebar}>{collapsed?<PanelLeftOpen className="h-4 w-4"/>:<PanelLeftClose className="h-4 w-4"/>}</Button></div>
            <nav id="studio-navigation" className="sidebar-navigation" aria-label="工作室导航">{SECTIONS.map(({id,label,Icon})=><button key={id} type="button" title={collapsed?label:undefined} aria-label={label} aria-current={section===id?'page':undefined} onClick={()=>selectSection(id,id==='home')}><Icon className="h-[18px] w-[18px]"/><span>{label}</span>{id==='projects'&&!listLoading&&<small>{projects.length}</small>}</button>)}</nav>
            <div className="sidebar-recent"><p>最近项目</p>{listLoading?<span className="sidebar-hint">正在加载…</span>:listError?<button className="sidebar-retry" onClick={refresh}>加载失败，点击重试</button>:projects.length?projects.slice(0,6).map(project=><Link key={project.id} title={project.name} to={`/p/${project.id}`}><MessageSquare className="h-3.5 w-3.5"/><span>{project.name}</span></Link>):<span className="sidebar-hint">从第一个想法开始</span>}</div>
            <div className="sidebar-bottom"><Link to="/agents" title={collapsed?'我的团队':undefined} aria-label="我的团队"><Users className="h-[18px] w-[18px]"/><span>我的团队</span></Link><Link to="/settings" title={collapsed?'生成设置':undefined} aria-label="生成设置"><Settings2 className="h-[18px] w-[18px]"/><span>生成设置</span></Link><div className="sidebar-account"><AccountMenu user={user}/></div></div>
          </aside>
          <main ref={contentPane} className="conversation-main">
            <header className="conversation-page-heading"><span>{section==='home'?'你的个人工作室':SECTIONS.find(item=>item.id===section)?.label}</span>{section!=='home'&&<Button variant="ghost" size="sm" className="gap-2" onClick={()=>selectSection('home',true)}><Plus className="h-4 w-4"/>开启新项目</Button>}</header>
            {section==='home'&&<section className="conversation-home" aria-label="开始新项目">
              <div className="conversation-welcome">
                <div className="conversation-team" aria-label="你的智能体伙伴">{TEAM_ROLES.map(r=><AgentPersona key={r.id} role={r.id} avatarClassName="h-12 w-12"/>)}</div>
                <h1>今天，想把什么想法变成现实？</h1>
                <p>从一句话开始，和你的团队一起，做出点不一样的。</p>
                <div className="conversation-input-card">
                  <Textarea ref={composer} aria-label="描述你想要的应用" value={prompt} maxLength={6000} onChange={e=>setPrompt(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&(e.ctrlKey||e.metaKey)&&!e.nativeEvent.isComposing){e.preventDefault();if(!creating&&prompt.trim().length>=4)void handleCreate();}}} disabled={creating} placeholder="说说你的想法，或者，你想解决什么问题…" className="conversation-input"/>
                  <div className="conversation-input-tools"><AgentModeSwitch compact value={agentMode} disabled={creating} onChange={mode=>{setAgentMode(mode);saveAgentMode(mode);}}/><div className="conversation-send-group"><span>{prompt.length?`${prompt.length} / 6000`:'Ctrl / ⌘ + Enter'}</span><Button size="icon" className="conversation-send" disabled={creating||prompt.trim().length<4} aria-label={creating?'正在创建项目':'发送需求并创建项目'} title="发送需求并创建项目" onClick={handleCreate}>{creating?<Loader2 className="h-5 w-5 animate-spin"/>:<ArrowUp className="h-5 w-5"/>}</Button></div></div>
                </div>
                <div className="conversation-composer-note"><span>{agentMode==='team'?'团队一起推敲方案，关键决定由你确认。':`${TEAM_ROLES.find(r=>r.id==='engineer')!.alias} 会负责规划、实现和检查。`}</span>{draftSaved&&<span>草稿已保存</span>}</div>
              </div>
            </section>}
            {section!=='home'&&<div className="conversation-section-content" key={section}>
            {section==='projects'&&<>
          <section id="projects" className="studio-projects">
            <div className="flex items-end justify-between gap-3">
              <div>
                <h1 className="text-3xl font-semibold tracking-tight">我的项目</h1>
                <p className="mt-1 text-sm text-muted-foreground">
                  {listLoading ? '正在加载…' : `共 ${projects.length} 个项目`}
                </p>
              </div>
              <Button variant="outline" size="sm" onClick={refresh} disabled={listLoading}>
                刷新
              </Button>
            </div>

            {listError ? (
              <div className="mt-4 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
                {listError}
              </div>
            ) : null}

            {listLoading ? (
              <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="rounded-lg border border-border bg-card p-5">
                    <Skeleton className="h-4 w-32" />
                    <Skeleton className="mt-3 h-3 w-full" />
                    <Skeleton className="mt-2 h-3 w-2/3" />
                    <Skeleton className="mt-5 h-3 w-24" />
                  </div>
                ))}
              </div>
            ) : projects.length === 0 ? (
              <div className="studio-empty"><span className="empty-index" aria-hidden="true">00</span><div><p className="text-lg font-medium">好作品，总有一个开始。</p><p className="mt-2 text-sm leading-6 text-muted-foreground">这里会收下你的每一个项目。现在，写下第一个想法。</p></div><Button variant="outline" className="gap-2" onClick={()=>selectSection('home',true)}><Plus className="h-4 w-4"/>新建项目</Button></div>
            ) : (
              <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {projects.map((project, index) => (
                  <div
                    key={project.id}
                    className="studio-project-card group"
                  >
                    <div className="mb-6 flex items-center justify-between"><span className="font-mono text-xs text-muted-foreground">{String(index+1).padStart(2,'0')} / PROJECT</span><ArrowUpRight className="h-5 w-5 text-muted-foreground"/></div>
                    <div className="flex items-start justify-between gap-2">
                      <button
                        type="button"
                        onClick={() => navigate(`/p/${project.id}`)}
                        className="min-w-0 text-left"
                      >
                        <p className="truncate text-base font-semibold hover:md:text-primary">
                          {project.name}
                        </p>
                      </button>
                      <div className="flex shrink-0 items-center gap-1">
                        {project.is_public && project.share_slug ? (
                          <Badge variant="secondary" className="h-5 gap-1 px-1.5 text-[10px] font-normal">
                            <Globe className="h-3 w-3" />
                            已分享
                          </Badge>
                        ) : null}
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-muted-foreground hover:md:text-destructive"
                          aria-label="删除项目"
                          disabled={!!project.role&&project.role!=='owner'}
                          onClick={() => setPendingDelete(project)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>

                    <p className="mt-2 line-clamp-2 min-h-[40px] text-sm leading-relaxed text-muted-foreground">
                      {project.description || project.initial_prompt || '暂无描述'}
                    </p>

                    <div className="mt-4 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                      <span className="tnum inline-flex items-center gap-1">
                        <Layers className="h-3.5 w-3.5" />v{project.current_version || 0}<span> · {project.agent_mode==='team'?'团队项目':'工程师项目'}</span>
                        {project.role&&project.role!=='owner'&&<span> · {project.role==='editor'?'协作编辑':'只读'}</span>}
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <Clock className="h-3.5 w-3.5" />
                        {relativeTime(project.updated_at)}
                      </span>
                    </div>

                    <Button
                      variant="outline"
                      size="sm"
                      className="mt-4 w-full gap-1.5"
                      onClick={() => navigate(`/p/${project.id}`)}
                    >
                      打开工作台
                      <ArrowUpRight className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </section>
            </>}
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
          </main>
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
    </div>
  );
}
