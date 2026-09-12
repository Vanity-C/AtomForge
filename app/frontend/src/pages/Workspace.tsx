/**
 * Two-pane workspace: agent chat and a tabbed preview, files and task board.
 *
 * This page owns the full core loop — generate, edit, run, version, share and
 * export — and restores everything from the database on refresh.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft,
  Check,
  ChevronRight,
  Copy,
  Download,
  Files,
  Globe,
  History,
  LayoutDashboard,
  Loader2,
  Monitor,
  RotateCcw,
  SendHorizonal,
  Share2,
  Sparkles,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { LoginGate, TopBar, useAuth } from '@/components/AppShell';
import CodePanel from '@/components/CodePanel';
import PreviewFrame from '@/components/PreviewFrame';
import { errorMessage, invoke } from '@/lib/sdk';
import VisualEditor from '@/components/VisualEditor';
import StudioPanel from '@/components/StudioPanel';
import RunNotice from '@/components/RunNotice';
import AgentConversation from '@/components/AgentConversation';
import ProjectTools from '@/components/ProjectTools';
import {fetchRun, studioUrl, type AgentMode, type StudioRun, type Artifact} from '@/lib/studio';
import {
  addMessage,
  commitFiles,
  disableShare,
  enableShare,
  getProject,
  listFiles,
  listMessages,
  listVersions,
  loadProfile,
  parseSnapshot,
  rollbackToVersion,
  updateProject,
  type MessageRecord,
  type ProjectRecord,
  type VersionRecord,
} from '@/lib/projectStore';
import { type GeneratedFile } from '@/lib/agent/codegen';
import { DEFAULT_PROFILE, type GenerationProfile } from '@/lib/agent/modelProvider';
import { exportProject } from '@/lib/exportProject';
import { validateCode } from '@/lib/validateCode';
import {workspaceFiles} from '@/lib/workspaceFiles';

interface ChatBubble {
  key: string;
  role: 'user' | 'assistant';
  content: string;
  version: number;
  streaming?: boolean;
}

function timeLabel(value?: string): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function Workspace() {
  const {id} = useParams<{id: string}>();
  return <ProjectWorkspace key={id}/>;
}

function ProjectWorkspace() {
  const { id } = useParams<{ id: string }>();
  const projectId = Number(id);
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const { authState, user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [project, setProject] = useState<ProjectRecord | null>(null);
  const canEdit=project?.role!=='viewer';
  const canManage=!project?.role||project.role==='owner';
  const [files, setFiles] = useState<GeneratedFile[]>([]);
  const [versions, setVersions] = useState<VersionRecord[]>([]);
  const [bubbles, setBubbles] = useState<ChatBubble[]>([]);
  const [profile, setProfile] = useState<GenerationProfile>(DEFAULT_PROFILE);

  const [input, setInput] = useState('');
  const [generating, setGenerating] = useState(false);
  const [run, setRun] = useState<StudioRun | null>(null);
  const [runId, setRunId] = useState('');
  const [runRefresh,setRunRefresh] = useState(0);
  const [chatRole,setChatRole] = useState('leader');
  const [race, setRace] = useState(false);
  const agentMode: AgentMode = project?.agent_mode || 'build';
  const [artifact, setArtifact] = useState<Artifact>();
  const [selection,setSelection] = useState<{source:string;text:string|null;tag:string}|null>(null);
  const [cloudSlug, setCloudSlug] = useState<string | null>(null);
  const seenDoneRef = useRef('');
  const openedRunRef = useRef('');
  const canCancel = run?.stage !== 'save';
  const streamingPath = null;

  const [activePath, setActivePath] = useState('App.jsx');
  const [draft, setDraft] = useState<string | null>(null);
  const [fileSource, setFileSource] = useState<{runId:string;source:'saved'|'draft'} | null>(null);
  const [savingFile, setSavingFile] = useState(false);

  const [rightTab, setRightTab] = useState<'preview' | 'code' | 'board'>('preview');
  const [historyOpen, setHistoryOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [shareBusy, setShareBusy] = useState(false);
  const [rollingBack, setRollingBack] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState('');

  const chatEndRef = useRef<HTMLDivElement>(null);
  const autostartRef = useRef(false);

  const [previewError, setPreviewError] = useState('');
  const [lastInstruction, setLastInstruction] = useState('');
  const [generationError, setGenerationError] = useState('');
  const [runConnectionWaiting,setRunConnectionWaiting]=useState(false);
  const handlePreviewStatus = useCallback((status: 'idle' | 'ready' | 'error', message: string) => {
    setPreviewError(status === 'error' ? message : '');
  }, []);


  const {files: displayFiles, hasDraft, showingDraft} = workspaceFiles(files,run,fileSource,draft!==null);
  const shareUrl = useMemo(
    () => (project?.share_slug ? `${window.location.origin}/s/${project.share_slug}` : ''),
    [project?.share_slug],
  );

  /* ------------------------------------------------------------- bootstrap */

  const loadAll = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const [proj, fileRows, versionRows, messageRows] = await Promise.all([
        getProject(projectId),
        listFiles(projectId),
        listVersions(projectId),
        listMessages(projectId),
      ]);
      setProject(proj);
      setNameDraft(proj.name);
      const plain: GeneratedFile[] = fileRows.map((f) => ({
        path: f.path,
        language: f.language,
        content: f.content,
      }));
      setFiles(plain);
      setVersions(versionRows);
      setBubbles(
        (messageRows as MessageRecord[])
          .filter((m) => m.role === 'user' || m.role === 'assistant')
          .map((m) => ({
            key: `db-${m.id}`,
            role: m.role as 'user' | 'assistant',
            content: m.content,
            version: m.version || 0,
          })),
      );
      const entry = plain.find((f) => f.path === (proj.entry_file || 'App.jsx')) ?? plain[0];
      if (entry) setActivePath(entry.path);
      setDraft(null);
      return { project: proj, files: plain, messages: messageRows };
    } catch (error) {
      setLoadError(errorMessage(error, '项目加载失败'));
      return null;
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  // Project data is owner-scoped, so wait until the session is resolved.
  useEffect(() => {
    if (authState === 'loading') return;
    if (authState === 'anonymous') {
      setLoading(false);
      return;
    }
    let mounted = true;
    (async () => {
      let activeProfile = DEFAULT_PROFILE;
      try {
        activeProfile = await loadProfile();
        if (mounted) setProfile(activeProfile);
      } catch {
        if (mounted) setProfile(DEFAULT_PROFILE);
      }
      const data = await loadAll();
      if (!mounted || !data) return;
      const shouldAutostart =
        searchParams.get('autostart') === '1' &&
        !autostartRef.current &&
        data.messages.length === 0 &&
        !!data.project.initial_prompt;
      if (shouldAutostart) {
        autostartRef.current = true;
        setSearchParams({}, { replace: true });
        void runAgent(data.project.initial_prompt, data.files, activeProfile, data.project.agent_mode);
      }
    })();
    return () => {
      mounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, authState]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ block: 'end' });
  }, [bubbles, generating]);

  /* -------------------------------------------------------------- generate */

  const reloadArtifact = useCallback(async () => {
    try {const a=await invoke<{artifact:Artifact|null;cloud_slug:string|null}>({url:studioUrl(projectId,'artifact')});setArtifact(a.artifact||undefined);setCloudSlug(a.cloud_slug);} catch {setArtifact(undefined);}
  },[projectId]);

  useEffect(()=>{if(authState==='authenticated')void reloadArtifact();},[authState,project?.current_version,reloadArtifact]);
  useEffect(()=>{
    if(authState!=='authenticated')return;
    let mounted=true;
    void invoke<{items:{id:string}[]}>({url:studioUrl(projectId,'runs')}).then(r=>{if(mounted&&r.items[0])setRunId(r.items[0].id);}).catch(()=>{});
    return ()=>{mounted=false;};
  },[projectId,authState]);
  useEffect(()=>{
    if(!runId)return;
    let mounted=true;let timer:ReturnType<typeof setTimeout>;
    const poll=async()=>{
      try {
        const r=await fetchRun(runId);if(!mounted||r.project_id!==projectId)return;
        setRunConnectionWaiting(false);setRun(r);setGenerating(['queued','running','awaiting_input'].includes(r.status));
        if(openedRunRef.current!==r.id){openedRunRef.current=r.id;if(r.mode==='team'&&['queued','running'].includes(r.status)){setRightTab('board');}}
        if(r.status==='done'&&seenDoneRef.current!==r.id){seenDoneRef.current=r.id;await loadAll();await reloadArtifact();setRightTab(profile.autoPreview?'preview':'code');}
        if(['queued','running','awaiting_input'].includes(r.status))timer=setTimeout(()=>void poll(),r.status==='awaiting_input'?3000:1200);
      }catch{if(mounted){setRunConnectionWaiting(true);timer=setTimeout(()=>void poll(),3000);}}
    };void poll();return ()=>{mounted=false;clearTimeout(timer);};
  },[runId,runRefresh,loadAll,reloadArtifact,profile.autoPreview]);

  const runAgent = useCallback(async(instruction:string,_baseFiles:GeneratedFile[],activeProfile:GenerationProfile,selectedMode:AgentMode=agentMode)=>{
    if(!instruction.trim()||generating||!canEdit)return;
    setGenerating(true);setLastInstruction(instruction);setGenerationError('');
    try {
      const r=await invoke<{id:string}>({url:studioUrl(projectId,'runs'),method:'POST',data:{instruction,model:activeProfile.model,mode:selectedMode==='team'?'team':race?'race':'build',temperature:activeProfile.temperaturePct/100}});
      setRun(null);setRunId(r.id);if(selectedMode==='team')setRightTab('board');await loadAll();
    }catch(e){setGenerating(false);setGenerationError(errorMessage(e));}
  },[projectId,generating,race,agentMode,loadAll,canEdit]);

  const handleSend = () => {
    const text = input.trim();
    if (!text) return;
    setInput('');
    void runAgent(text, files, profile);
  };

  /* ------------------------------------------------------------ edit files */

  const activeFile = activePath ? displayFiles.find((f) => f.path === activePath) ?? displayFiles[0] : undefined;
  const dirty = draft !== null && activeFile ? draft !== activeFile.content : false;

  const handleSaveFile = async () => {
    if (!activeFile || draft === null || !dirty || savingFile || showingDraft || generating || !canEdit) return;
    setSavingFile(true);
    try {
      const next = files.map((f) => (f.path === activeFile.path ? { ...f, content: draft } : f));
      await validateCode(next);
      const version = await commitFiles(projectId, next, {
        summary: `手动编辑 ${activeFile.path}`,
        prompt: '',
        source: 'manual_edit',
        expectedVersion:project?.current_version,
      });
      setFiles(next);
      setDraft(null);
      const [freshProject, freshVersions] = await Promise.all([
        getProject(projectId),
        listVersions(projectId),
      ]);
      setProject(freshProject);
      setVersions(freshVersions);
      toast.success(`已保存为 v${version}`);
      try {await invoke({url:studioUrl(projectId,'build'),method:'POST',timeoutMs:90000});await reloadArtifact();}catch(e){toast.error('源码已保存，构建未通过',{description:errorMessage(e)});}
    } catch (error) {
      toast.error('保存失败', { description: errorMessage(error) });
    } finally {
      setSavingFile(false);
    }
  };

  /* -------------------------------------------------------------- rollback */

  const handleRollback = async (version: VersionRecord) => {
    setRollingBack(version.version);
    try {
      const newVersion = await rollbackToVersion(projectId, version);
      const snapshot = parseSnapshot(version.files_snapshot);
      setFiles(snapshot);
      setDraft(null);
      const entry = snapshot.find((f) => f.path === 'App.jsx') ?? snapshot[0];
      if (entry) setActivePath(entry.path);
      const [freshProject, freshVersions] = await Promise.all([
        getProject(projectId),
        listVersions(projectId),
      ]);
      setProject(freshProject);
      setVersions(freshVersions);
      await addMessage({
        projectId,
        role: 'assistant',
        content: `已回滚到 v${version.version}，并保存为 v${newVersion}。`,
        phase: 'done',
        version: newVersion,
      });
      setBubbles((prev) => [
        ...prev,
        {
          key: `rb-${Date.now()}`,
          role: 'assistant',
          content: `已回滚到 v${version.version}，并保存为 v${newVersion}。`,
          version: newVersion,
        },
      ]);
      setHistoryOpen(false);
      setRightTab('preview');
      toast.success(`已回滚到 v${version.version}`);
      try {await invoke({url:studioUrl(projectId,'build'),method:'POST',timeoutMs:90000});await reloadArtifact();}catch(e){toast.error('回滚已保存，构建未通过',{description:errorMessage(e)});}
    } catch (error) {
      toast.error('回滚失败', { description: errorMessage(error) });
    } finally {
      setRollingBack(null);
    }
  };

  /* ----------------------------------------------------------------- share */

  const handleToggleShare = async (next: boolean) => {
    if (!project) return;
    setShareBusy(true);
    try {
      if (next) {
        if (!files.length) {
          toast.error('还没有可分享的应用', { description: '请先让智能体生成代码。' });
          return;
        }
        const slug = await enableShare(project);
        setProject({ ...project, share_slug: slug, is_public: true });
        toast.success('公开分享已开启');
      } else {
        await disableShare(project);
        setProject({ ...project, is_public: false });
        toast.success('公开分享已关闭');
      }
    } catch (error) {
      toast.error('操作失败', { description: errorMessage(error) });
    } finally {
      setShareBusy(false);
    }
  };

  const handleCopyLink = async () => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
    } catch {
      const el = document.createElement('textarea');
      el.value = shareUrl;
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
    }
    setCopied(true);
    toast.success('链接已复制');
    setTimeout(() => setCopied(false), 1800);
  };

  /* ---------------------------------------------------------------- export */

  const handleExport = () => {
    if (!files.length || !project) {
      toast.error('还没有可导出的代码');
      return;
    }
    void exportProject(project.name, {projectId}).then(()=>toast.success('源码已开始下载')).catch(e=>toast.error(errorMessage(e)));
  };

  /* ---------------------------------------------------------------- rename */

  const handleRename = async () => {
    if (!project) return;
    const name = nameDraft.trim();
    if (!name || name === project.name) {
      setRenaming(false);
      setNameDraft(project.name);
      return;
    }
    try {
      await updateProject(project.id, { name });
      setProject({ ...project, name });
      toast.success('项目已重命名');
    } catch (error) {
      toast.error('重命名失败', { description: errorMessage(error) });
    } finally {
      setRenaming(false);
    }
  };

  /* ------------------------------------------------------------------ view */

  if (authState === 'anonymous') {
    return (
      <div className="flex min-h-screen flex-col bg-background">
        <TopBar authState={authState} />
        <LoginGate
          title="需要登录才能打开工作台"
          description="项目只对创建它的账号可见，登录后即可继续迭代。"
        />
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background">
      <TopBar
        authState={authState}
        user={user}
        brandTo="/dashboard"
        center={
          <div className="flex min-w-0 items-center gap-1.5 text-sm">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1 px-1.5 text-muted-foreground"
              onClick={() => navigate('/dashboard')}
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              项目
            </Button>
            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" />
            {renaming ? (
              <Input
                autoFocus
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                onBlur={handleRename}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleRename();
                  if (e.key === 'Escape') {
                    setRenaming(false);
                    setNameDraft(project?.name ?? '');
                  }
                }}
                className="h-7 w-48 text-sm"
              />
            ) : (
              <button
                type="button"
                onClick={() => setRenaming(true)}
                className="truncate rounded px-1 py-0.5 font-medium hover:md:bg-accent"
                title="点击重命名"
              >
                {project?.name ?? '加载中…'}
              </button>
            )}
            {project?.current_version ? (
              <Badge variant="secondary" className="tnum h-5 shrink-0 px-1.5 text-[10px] font-normal">
                v{project.current_version}
              </Badge>
            ) : null}
          </div>
        }
        right={
          <>
            <Sheet open={historyOpen} onOpenChange={setHistoryOpen}>
              <SheetTrigger asChild>
                <Button variant="ghost" size="sm" className="h-8 gap-1.5 px-2 text-xs">
                  <History className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">版本</span>
                </Button>
              </SheetTrigger>
              <SheetContent className="w-full sm:max-w-md">
                <SheetHeader>
                  <SheetTitle>版本历史</SheetTitle>
                  <SheetDescription>
                    每次生成、手动保存和回滚都会留下完整快照，可随时回到任意版本。
                  </SheetDescription>
                </SheetHeader>
                <div className="mt-5 space-y-3 overflow-y-auto pb-6" style={{ maxHeight: 'calc(100vh - 160px)' }}>
                  {versions.length === 0 ? (
                    <p className="text-sm text-muted-foreground">还没有版本记录。</p>
                  ) : (
                    versions.map((version) => {
                      const isCurrent = version.version === project?.current_version;
                      const count = parseSnapshot(version.files_snapshot).length;
                      return (
                        <div
                          key={version.id}
                          className="rounded-lg border border-border bg-card p-3.5"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2">
                              <span className="tnum font-mono text-sm font-semibold">
                                v{version.version}
                              </span>
                              {isCurrent ? (
                                <Badge className="h-5 bg-accent px-1.5 text-[10px] font-normal text-accent-foreground hover:bg-accent">
                                  当前
                                </Badge>
                              ) : null}
                              <span className="text-[11px] text-muted-foreground">
                                {version.source === 'agent'
                                  ? '智能体生成'
                                  : version.source === 'manual_edit'
                                    ? '手动编辑'
                                    : '回滚'}
                              </span>
                            </div>
                            <span className="tnum text-[11px] text-muted-foreground">
                              {timeLabel(version.created_at)}
                            </span>
                          </div>
                          <p className="mt-2 line-clamp-3 text-sm leading-relaxed text-muted-foreground">
                            {version.summary || version.prompt || '无描述'}
                          </p>
                          <div className="mt-3 flex items-center justify-between">
                            <span className="tnum text-[11px] text-muted-foreground">
                              {count} 个文件
                            </span>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 gap-1.5 px-2 text-xs"
                              disabled={!canEdit || generating || isCurrent || rollingBack !== null}
                              onClick={() => handleRollback(version)}
                            >
                              {rollingBack === version.version ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <RotateCcw className="h-3.5 w-3.5" />
                              )}
                              回滚到此版本
                            </Button>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </SheetContent>
            </Sheet>

            <Sheet open={shareOpen} onOpenChange={setShareOpen}>
              <SheetTrigger asChild>
                <Button variant="ghost" size="sm" className="h-8 gap-1.5 px-2 text-xs">
                  <Share2 className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">分享</span>
                </Button>
              </SheetTrigger>
              <SheetContent className="w-full sm:max-w-md">
                <SheetHeader>
                  <SheetTitle>公开分享</SheetTitle>
                  <SheetDescription>
                    开启后任何拿到链接的人都能免登录查看应用运行效果与只读源码，不会暴露你的账号信息，也无法编辑。
                  </SheetDescription>
                </SheetHeader>

                <div className="mt-6 space-y-5">
                  <div className="flex items-center justify-between rounded-lg border border-border bg-card px-4 py-3">
                    <div className="flex items-center gap-2.5">
                      <Globe className="h-4 w-4 text-muted-foreground" />
                      <div>
                        <Label htmlFor="share-toggle" className="text-sm font-medium">
                          开启公开只读链接
                        </Label>
                        <p className="text-xs text-muted-foreground">
                          {project?.is_public ? '任何人都可以访问' : '目前仅你自己可见'}
                        </p>
                      </div>
                    </div>
                    <Switch
                      id="share-toggle"
                      checked={!!project?.is_public}
                      disabled={shareBusy || !canManage}
                      onCheckedChange={handleToggleShare}
                    />
                  </div>

                  {project?.is_public && shareUrl ? (
                    <div className="space-y-2">
                      <Label className="text-xs text-muted-foreground">分享链接</Label>
                      <div className="flex gap-2">
                        <Input readOnly value={shareUrl} className="font-mono text-xs" />
                        <Button variant="outline" className="shrink-0 gap-1.5" onClick={handleCopyLink}>
                          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                          复制
                        </Button>
                      </div>
                      <p className="tnum text-xs text-muted-foreground">
                        已被访问 {project.view_count || 0} 次
                      </p>
                      <Button
                        variant="outline"
                        className="w-full"
                        onClick={() => window.open(shareUrl, '_blank', 'noopener')}
                      >
                        打开分享页预览
                      </Button>
                    </div>
                  ) : null}

                  <div className="rounded-lg border border-border bg-muted/40 p-4">
                    <p className="text-sm font-medium">导出源码</p>
                    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                      把当前版本的全部文件打包为 zip 下载，附带本地运行说明。
                    </p>
                    <Button variant="outline" className="mt-3 w-full gap-1.5" onClick={handleExport}>
                      <Download className="h-3.5 w-3.5" />
                      下载 zip
                    </Button>
                  </div>
                </div>
              </SheetContent>
            </Sheet>

            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-1.5 px-2 text-xs"
              onClick={handleExport}
            >
              <Download className="h-3.5 w-3.5" />
              <span className="hidden md:inline">导出</span>
            </Button>
            <ProjectTools projectId={projectId} role={project?.role} disabled={generating} onChanged={()=>{void reloadArtifact();}}/>
          </>
        }
      />

      {loadError ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
          <p className="text-sm text-destructive">{loadError}</p>
          <Button variant="outline" onClick={loadAll}>
            重新加载
          </Button>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto md:flex-row md:overflow-hidden">
          {/* Chat pane */}
          <section aria-label="智能体对话" className="flex h-[60dvh] min-h-[440px] w-full shrink-0 flex-col border-b border-border bg-card md:h-auto md:min-h-0 md:w-[320px] md:border-b-0 md:border-r lg:w-[380px]">
            <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
              <Sparkles className="h-3.5 w-3.5 text-primary" />
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {agentMode==='team'?'智能体团队':'智能体'}
              </span>
              <span className="ml-auto font-mono text-[11px] text-muted-foreground">
                {profile.model}
              </span>
            </div>

            <RunNotice run={run} onOpenBoard={()=>{setRightTab('board');if(run?.status==='awaiting_input')setChatRole('all');}}/>
            {runConnectionWaiting&&<p role="status" className="shrink-0 border-b px-3 py-2 text-xs text-muted-foreground">进度连接暂时中断，正在自动恢复；请勿重复提交需求。</p>}
            <AgentConversation filePaths={displayFiles.map(file=>file.path)} onOpenFile={path=>{if(path!==activeFile?.path&&dirty){toast.info("请先保存或放弃当前文件的修改，再查看其他文件");setRightTab("code");return;}if(path!==activeFile?.path)setDraft(null);setActivePath(path);setRightTab("code");}} projectId={projectId} run={run} role={chatRole} onRole={setChatRole} team={agentMode==='team'} model={profile.model} canEdit={canEdit} legacy={bubbles} onScheduled={id=>{setRunId(id);setRunRefresh(n=>n+1);}} onUpdated={()=>setRunRefresh(n=>n+1)} onImplement={text=>{setChatRole('all');setInput(text);}}/>

            <div className={`shrink-0 border-t border-border p-3 ${chatRole!=='all'?'hidden':''}`}>
              {previewError && !generating ? <div className="mb-2 rounded border border-destructive/30 bg-destructive/5 p-2 text-xs">
                <p className="mb-2 text-destructive">预览运行出错，可让智能体根据错误修复。</p>
                <Button size="sm" variant="outline" onClick={() => void runAgent(`请修复当前应用的运行错误，保留原有功能。错误信息：${previewError.slice(0, 2000)}`, files, profile)}>让 AI 修复</Button>
              </div> : null}
              {generationError && !generating ? <div className="mb-2 text-xs text-destructive">
                <p>{generationError}</p>
                <Button size="sm" variant="ghost" onClick={() => void runAgent(lastInstruction, files, profile)}>重试上次需求</Button>
              </div> : null}
              {run?.status==='done'&&!generating&&canEdit&&<div aria-label="下一步建议" className="mb-2 flex flex-wrap gap-1.5">{[['优化手机体验','请优化当前应用的手机布局、触摸操作和窄屏可读性，保留已有功能。'],['完善空状态','请检查当前应用的数据为空、加载中和操作失败时的体验，补上清晰的说明与可执行的下一步。'],['补充新手引导','请为当前应用增加简洁、可跳过的新手引导，帮助第一次使用的人完成核心操作，保留已有功能。']].map(([label,text])=><button key={label} type="button" className="rounded-full border px-2 py-1 text-[10px] text-muted-foreground hover:border-primary hover:text-primary" onClick={()=>{const previous=input;setInput(text);if(previous.trim())toast.success('建议已填入，可修改后发送',{action:{label:'撤销',onClick:()=>setInput(previous)}});}}>{label}</button>)}</div>}
              {agentMode==='build'&&<label className="mb-2 flex items-center gap-2 text-xs text-muted-foreground"><input type="checkbox" checked={race} disabled={generating} onChange={e=>setRace(e.target.checked)}/>比较两个模型候选（消耗更多额度）</label>}
              <Textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    handleSend();
                  }
                }}
                disabled={generating || !canEdit}
                placeholder={
                  files.length
                    ? '继续迭代，例如：把统计改成柱状图，并加上深色模式'
                    : '描述你想要的应用…'
                }
                className="min-h-[76px] resize-none text-sm"
              />
              <div className="mt-2 flex items-center justify-between">
                <span className="text-[11px] text-muted-foreground">⌘/Ctrl + Enter 发送</span>
                <Button
                  size="sm"
                  className="gap-1.5"
                  disabled={!canEdit || (generating ? !canCancel : !input.trim())}
                  onClick={generating ? () => {if(runId)void invoke({url:`/api/v1/studio/runs/${runId}`,method:'DELETE'}).then(()=>setRunRefresh(n=>n+1)).catch(e=>toast.error(errorMessage(e)));} : handleSend}
                >
                  {generating ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <SendHorizonal className="h-3.5 w-3.5" />
                  )}
                  {generating ? (canCancel ? (run?.status==='awaiting_input'?'停止任务':'停止生成') : '正在保存…') : '发送'}
                </Button>
              </div>
            </div>
          </section>

          {/* Keep inactive panels mounted so tab changes preserve previews and drafts. */}
          <Tabs value={rightTab} onValueChange={(v) => setRightTab(v as typeof rightTab)} className="flex h-[65dvh] min-h-[400px] min-w-0 flex-1 shrink-0 flex-col md:h-auto md:min-h-0">
            <div className="shrink-0 overflow-x-auto border-b border-border bg-card px-3 py-2">
              <TabsList aria-label="工作区" className="h-9 gap-1">
                <TabsTrigger value="preview" className="gap-1.5 text-xs"><Monitor className="h-3.5 w-3.5" />预览</TabsTrigger>
                <TabsTrigger value="code" className="gap-1.5 text-xs"><Files className="h-3.5 w-3.5" />文件{dirty && <span aria-label="有未保存的修改" className="h-1.5 w-1.5 rounded-full bg-primary" />}</TabsTrigger>
                <TabsTrigger value="board" className="gap-1.5 text-xs"><LayoutDashboard className="h-3.5 w-3.5" />工作看板{run?.status==='awaiting_input'&&<span className="text-[10px] text-primary">待确认</span>}{generating&&run?.status!=='awaiting_input' && <Loader2 aria-label="任务执行中" className="h-3 w-3 animate-spin" />}{run?.status === 'review' && <span className="h-1.5 w-1.5 rounded-full bg-primary" />}</TabsTrigger>
              </TabsList>
            </div>
              <TabsContent value="code" forceMount className="m-0 flex min-h-0 min-w-0 flex-1 data-[state=inactive]:hidden">
                <div className="flex min-h-0 w-full flex-col">
                  {hasDraft && <div className="shrink-0 border-b border-border bg-muted/30 px-3 py-2 text-xs">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="secondary">{showingDraft ? (run?.status==='error'?'生成草稿 · 验收未通过':['cancelled','interrupted'].includes(run?.status??'')?'生成草稿 · 任务已中断':'生成草稿 · 待验收') : `已保存 v${project?.current_version??0}`}</Badge>
                      {files.length>0 && <Button size="sm" variant="ghost" className="h-7 text-xs" disabled={draft!==null} onClick={()=>{if(run)setFileSource({runId:run.id,source:showingDraft?'saved':'draft'});}}>{showingDraft?'查看已保存版本':'查看生成草稿'}</Button>}
                    </div>
                    <p className="mt-1 leading-relaxed text-muted-foreground">{showingDraft?'代码已生成并保留，可在此查看。通过验收后会保存为正式版本并更新预览。':'正在查看已保存版本；生成草稿单独保留。'}{draft!==null?' 请先保存或放弃当前编辑，再切换文件来源。':''}</p>
                  </div>}
                  <div className="min-h-0 flex-1">
                  {loading ? (
                    <div className="p-4">
                      <Skeleton className="h-full min-h-[240px] w-full" />
                    </div>
                  ) : (
                    <CodePanel
                      files={displayFiles}
                      activePath={activeFile?.path ?? ''}
                      onSelect={(path) => {
                        if (path === activeFile?.path || savingFile) return;
                        if(path!==activeFile?.path&&dirty){toast.info('请先保存或放弃当前文件的修改');return;}
                        setActivePath(path);
                        setDraft(null);
                      }}
                      readOnly={showingDraft || generating || !canEdit}
                      streamingPath={streamingPath}
                      draft={draft ?? activeFile?.content ?? ''}
                      dirty={dirty}
                      saving={savingFile}
                      onDraftChange={setDraft}
                      onSave={handleSaveFile}
                      onDiscard={() => setDraft(null)}
                    />
                  )}
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="preview" forceMount className="m-0 flex min-h-0 min-w-0 flex-1 data-[state=inactive]:hidden">
                <div className="min-h-0 w-full">
                  {selection&&<VisualEditor key={selection.source} selection={selection} projectId={projectId} version={project?.current_version||0} onClose={()=>setSelection(null)} onSaved={()=>{setSelection(null);void loadAll();void reloadArtifact();}}/>}
                  <PreviewFrame files={files} artifact={artifact} cloudSlug={cloudSlug} onElementSelect={generating||!canEdit?undefined:setSelection} storageKey={`owner-${user?.id}-project-${projectId}`} onStatusChange={handlePreviewStatus} />
                </div>
              </TabsContent>
              <TabsContent value="board" forceMount className="m-0 min-h-0 flex-1 overflow-y-auto bg-muted/20 data-[state=inactive]:hidden">
                <StudioPanel run={run} agentMode={agentMode} cloudSlug={cloudSlug} onRun={setRunId} onSaved={()=>{void fetchRun(runId).then(setRun);void loadAll();void reloadArtifact();}}/>
              </TabsContent>
          </Tabs>
        </div>
      )}
    </div>
  );
}
