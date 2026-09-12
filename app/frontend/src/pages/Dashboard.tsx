/**
 * Project dashboard: list, create and open projects.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  ArrowUpRight,
  Clock,
  FolderPlus,
  Globe,
  Layers,
  Loader2,
  Sparkles,
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
import { LoginGate, TopBar, useAuth } from '@/components/AppShell';
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
import {TEAM_ROLES} from '@/lib/studio';
import AgentModeSwitch, {loadAgentMode,saveAgentMode} from '@/components/AgentModeSwitch';

const IDEA_CHIPS = [
  '做一个番茄钟，支持自定义时长和任务清单',
  '做一个个人记账应用，按分类统计月度支出',
  '做一个看板式待办应用，支持标签筛选',
  '做一个健身打卡应用，有周视图和连续天数统计',
];

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
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { authState, user } = useAuth();
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState('');
  const [prompt, setPrompt] = useState(searchParams.get('prompt') ?? '');
  const [creating, setCreating] = useState(false);
  const [agentMode,setAgentMode] = useState(loadAgentMode);
  const [profile, setProfile] = useState<GenerationProfile>(DEFAULT_PROFILE);
  const [pendingDelete, setPendingDelete] = useState<ProjectRecord | null>(null);
  const composer = useRef<HTMLTextAreaElement>(null);
  const draftKey = authState === 'authenticated' && user ? `atomforge:create-draft:${user.id}` : '';
  const [draftOwner, setDraftOwner] = useState('');
  const [draftSaved, setDraftSaved] = useState(false);
  useEffect(() => {
    if (!draftKey) { setDraftOwner(''); return; }
    let saved = '';
    try { saved = localStorage.getItem(draftKey) || ''; } catch { /* Storage may be unavailable. */ }
    setPrompt((searchParams.get('prompt') ?? saved).slice(0, 6000));
    setDraftOwner(draftKey);
  }, [draftKey, searchParams]);
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
    // Wait until the example dialog has released its focus trap.
    setTimeout(() => { composer.current?.focus(); composer.current?.scrollIntoView({block:'center', behavior:'smooth'}); }, 0);
    toast.success('需求已填入，准备好后再开始创建', previous.trim() ? {
      action: {label:'撤销', onClick:()=>setPrompt(previous)},
    } : undefined);
  };

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
    <div className="flex min-h-screen flex-col bg-background">
      <TopBar authState={authState} user={user} brandTo="/dashboard" />

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
        <main className="mx-auto w-full max-w-screen-xl flex-1 px-4 py-10 sm:px-6 lg:px-8">
          <section className="mx-auto max-w-3xl pb-6 pt-4 sm:pb-10 sm:pt-10">
            <div className="mb-5 flex justify-center -space-x-2" aria-label="你的智能体伙伴">
              {(agentMode==='team'?TEAM_ROLES:TEAM_ROLES.filter(r=>r.id==='engineer')).map(r=><AgentPersona key={r.id} role={r.id} avatarClassName="h-16 w-16 sm:h-20 sm:w-20" className="ring-4 ring-background"/>)}
            </div>
            <h1 className="text-center text-2xl font-semibold tracking-tight sm:text-3xl">{agentMode==='team'?'和伙伴们一起，把想法做成应用':'和 Neo 一起，做出你的下一个应用'}</h1>
            <p className="mt-3 text-center text-sm leading-6 text-muted-foreground">{agentMode==='team'?'Milo 会梳理需求并带队完成设计、开发与验收，只在必要决策时请你确认。':'告诉 Neo 你的想法，从第一版开始，边体验边完善。'}</p>
            <div className="mt-7 rounded-2xl border bg-card p-4 shadow-sm sm:p-5">
              <Textarea ref={composer} aria-label="描述你想要的应用" value={prompt} maxLength={6000} onChange={e=>setPrompt(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&(e.ctrlKey||e.metaKey)&&!e.nativeEvent.isComposing){e.preventDefault();if(!creating&&prompt.trim().length>=4)void handleCreate();}}} disabled={creating} placeholder="你想做什么？描述一个想法，或说说它要解决的问题…" className="min-h-[120px] resize-none border-0 bg-transparent p-0 text-sm leading-7 shadow-none focus-visible:ring-0"/>
              <div className="mt-2 flex flex-wrap justify-between gap-2 text-[11px] text-muted-foreground"><span>{draftSaved?'草稿已保留在此浏览器':'从一个具体的小需求开始'}</span><span>Ctrl / ⌘ + Enter 创建</span></div>
              <div className="mt-4 flex flex-wrap items-start justify-between gap-4 border-t pt-4">
                <AgentModeSwitch value={agentMode} disabled={creating} onChange={mode=>{setAgentMode(mode);saveAgentMode(mode);}}/>
                <Button className="ml-auto gap-2 rounded-xl" disabled={creating||prompt.trim().length<4} onClick={handleCreate}>{creating?<Loader2 className="h-4 w-4 animate-spin"/>:<ArrowUpRight className="h-4 w-4"/>}{creating?'正在创建项目…':'创建并开始生成'}</Button>
              </div>
            </div>
            <div className="mt-4 flex flex-wrap justify-center gap-2">{IDEA_CHIPS.map(chip=><button key={chip} type="button" disabled={creating} onClick={()=>fillIdea(chip)} className="rounded-full border bg-background px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary disabled:opacity-50">{chip}</button>)}</div>
            <p className="mt-4 text-center text-[11px] text-muted-foreground">{profile.model} · 每次创建都是独立的新项目</p>
            <nav aria-label="首页快捷导航" className="mt-4 flex justify-center gap-5 text-xs text-muted-foreground"><a href="#inspiration" className="hover:text-primary">找灵感</a><a href="#projects" className="hover:text-primary">我的项目</a><a href="#getting-started" className="hover:text-primary">使用帮助</a></nav>
          </section>

          <StarterGallery onUse={fillIdea} disabled={creating}/>
          <section id="projects" className="mt-10 scroll-mt-20">
            <div className="flex items-end justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold tracking-tight">我的项目</h2>
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
              <div className="mt-5 rounded-lg border border-dashed border-border bg-card/60 px-6 py-14 text-center">
                <Layers className="mx-auto h-6 w-6 text-muted-foreground/60" />
                <p className="mt-3 text-base font-semibold">还没有项目</p>
                <p className="mx-auto mt-1.5 max-w-sm text-sm text-muted-foreground">
                  在上面写下你的第一个想法，智能体会生成一个可运行的应用，代码和对话都会自动保存。
                </p>
              </div>
            ) : (
              <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {projects.map((project) => (
                  <div
                    key={project.id}
                    className="group flex flex-col rounded-lg border border-border bg-card p-5 transition-shadow duration-200 ease-out-quart hover:md:shadow-sm"
                  >
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

                    <div className="mt-4 flex items-center gap-3 text-xs text-muted-foreground">
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
          <section id="getting-started" aria-label="使用帮助" className="mt-10 scroll-mt-20 border-t pt-8">
            <h2 className="text-lg font-semibold">需要一点帮助？</h2>
            <p className="mt-1 text-sm text-muted-foreground">从第一句话到第一版应用。</p>
            <div className="mt-4 divide-y rounded-xl border bg-card px-4 sm:px-5">{[
              ['第一次创建，应该怎么描述？','说清楚给谁用、解决什么问题，以及最重要的两三个操作。例如：给自己用的记账本，可以新增支出、按月筛选，刷新后保留记录。也可以先试用上方灵感库，再修改示例需求。'],
              ['工程师和团队模式怎么选择？','简单明确的需求可以交给 Neo；需要先讨论方案时选择团队模式，Milo 会组织需求梳理、设计、开发与验收，只在必要决策时请你确认。模式在创建项目时确定，之后保持固定；每次创建都有独立的对话和代码。'],
              ['团队向我确认时，可以慢一点吗？','可以。确认卡默认给你 30 秒选择推荐方案；点击选项或填写想法会暂停倒计时，也可以点“继续思考”后再决定。选择“其他”可填写自己的方案，确认后团队会据此继续。'],
              ['刷新页面后，内容会丢吗？','首页需求草稿保留在当前浏览器，并按账号区分；创建成功后会清空。项目的对话、代码和版本保存到服务端，登录后可继续。灵感库的试用数据只保留到关闭预览。'],
              ['如何查看和分享做好的应用？','打开项目工作台，在右侧标签页查看预览、文件和工作看板。生成完成后可体验应用、继续提出修改，或使用工作台的分享功能。外部访问需要部署地址能够从公网访问，本地地址仅适用于当前电脑。'],
            ].map(([question,answer])=><details key={question} className="group py-4"><summary className="cursor-pointer text-sm font-medium focus-visible:outline-primary">{question}</summary><p className="mt-3 max-w-3xl text-sm leading-7 text-muted-foreground">{answer}</p></details>)}</div>
          </section>
        </main>
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
