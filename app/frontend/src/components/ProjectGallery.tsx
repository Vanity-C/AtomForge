import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowDownWideNarrow, ArrowUpRight, Check, FolderOpen, Globe, ImageOff, Loader2, MoreHorizontal, Pencil, Plus, RefreshCw, Search, Star, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { errorMessage, readToken } from '@/lib/sdk';
import { projectThumbnailLoader, updateProject, type ProjectRecord, type ProjectThumbnail } from '@/lib/projectStore';
import '@/styles/project-gallery.css';

function Cover({project}: {project: ProjectRecord}) {
  const frame = useRef<HTMLDivElement>(null);
  const [cover, setCover] = useState<ProjectThumbnail | null>(() => projectThumbnailLoader.peek(project.id, project.current_version));
  const [loading, setLoading] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let alive = true;
    let requested = false;
    const session = readToken();
    const current = () => alive && readToken() === session;
    const cached = projectThumbnailLoader.peek(project.id, project.current_version);
    setCover(cached);
    setLoading(false);
    if (!project.current_version || cached) return;
    const observer = new IntersectionObserver(entries => {
      if (requested || !entries.some(entry => entry.isIntersecting)) return;
      requested = true;
      observer.disconnect();
      setLoading(true);
      void (async () => {
        if (!current()) return;
        try {
          const result = await projectThumbnailLoader.load(project.id, project.current_version, current);
          if (current()) setCover(result.version === project.current_version ? result : {status: 'changed', version: result.version});
        } catch {
          if (current()) setCover({status: 'unavailable', version: project.current_version});
        } finally {
          if (current()) setLoading(false);
        }
      })();
    }, {rootMargin: '160px'});
    if (frame.current) observer.observe(frame.current);
    return () => {alive = false; observer.disconnect();};
  }, [project.id, project.current_version, attempt]);
  const ready = cover?.status === 'ready' && cover.version === project.current_version && cover.src;
  const failed = cover?.status === 'unavailable';
  return <div ref={frame} className={`project-cover ${ready ? 'has-cover' : ''}`}>
    <Link to={`/p/${project.id}`} className="project-cover-link" aria-label={`打开项目：${project.name}`}>
      {ready ? <img src={cover.src} alt={`${project.name} 的实际应用预览`} loading="lazy" /> : <div className="project-cover-placeholder">
        <span className="project-cover-symbol">{loading ? <Loader2 className="animate-spin"/> : failed ? <ImageOff/> : <FolderOpen/>}</span>
        <strong>{loading ? '正在准备应用预览' : !project.current_version ? '好想法，等你开始' : cover?.status === 'changed' ? '项目已有新版本' : failed ? '预览暂时不可用' : '应用预览待生成'}</strong>
        <span>{loading ? '首次加载后将自动保存' : !project.current_version ? '打开项目，把灵感变成第一版作品' : cover?.status === 'changed' ? '刷新项目列表查看最新作品' : failed ? '仍可打开项目继续创作' : '打开工作台构建当前版本后显示'}</span>
      </div>}
      {ready && <span className="project-cover-open">继续创作 <ArrowUpRight size={15}/></span>}
    </Link>
    {failed && <button type="button" className="project-cover-retry" onClick={() => setAttempt(value => value + 1)}><RefreshCw size={12}/>重试预览</button>}
  </div>;
}

function projectDate(value?: string) {
  if (!value || Number.isNaN(new Date(value).getTime())) return '刚刚更新';
  return new Intl.DateTimeFormat('zh-CN', {year: 'numeric', month: '2-digit', day: '2-digit'}).format(new Date(value));
}

interface Props {
  projects: ProjectRecord[];
  loading: boolean;
  refreshing: boolean;
  error: string;
  userId: string;
  onRefresh: () => void;
  onCreate: () => void;
  onDelete: (project: ProjectRecord) => void;
}

export default function ProjectGallery({projects, loading, refreshing, error, userId, onRefresh, onCreate, onDelete}: Props) {
  const [filter, setFilter] = useState<'all' | 'favorites'>('all');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState('updated');
  const [favorites, setFavorites] = useState<number[]>([]);
  const [renaming, setRenaming] = useState<ProjectRecord | null>(null);
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const mounted = useRef(true);
  const activeUser = useRef(userId);
  activeUser.current = userId;
  useEffect(() => {mounted.current = true; return () => {mounted.current = false;};}, []);
  const storageKey = `atomforge:favorite-projects:${userId}`;
  useEffect(() => {
    setRenaming(null); setName(''); setSaving(false); setQuery(''); setFilter('all');
    try {
      const parsed: unknown = JSON.parse(localStorage.getItem(storageKey) || '[]');
      setFavorites(Array.isArray(parsed) ? parsed.filter((id): id is number => typeof id === 'number') : []);
    } catch {setFavorites([]);}
  }, [storageKey]);
  const favoriteCount = projects.filter(project => favorites.includes(project.id)).length;
  const filtered = useMemo(() => projects.filter(project =>
    (filter === 'all' || favorites.includes(project.id)) &&
    `${project.name} ${project.description} ${project.initial_prompt}`.toLowerCase().includes(query.trim().toLowerCase()),
  ).sort((a, b) => sort === 'name' ? a.name.localeCompare(b.name, 'zh-CN') :
    (new Date(sort === 'created' ? b.created_at || 0 : b.updated_at || 0).getTime() -
     new Date(sort === 'created' ? a.created_at || 0 : a.updated_at || 0).getTime()) || b.id - a.id), [projects, filter, favorites, query, sort]);
  const toggleFavorite = (project: ProjectRecord) => {
    const next = favorites.includes(project.id) ? favorites.filter(id => id !== project.id) : [...favorites, project.id];
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
      setFavorites(next);
    } catch {toast.error('浏览器无法保存收藏，请检查存储设置');}
  };
  const rename = async () => {
    if (!renaming || !name.trim() || saving) return;
    const owner = userId, session = readToken();
    const current = () => mounted.current && activeUser.current === owner && readToken() === session;
    setSaving(true);
    try {
      await updateProject(renaming.id, {name: name.trim()});
      if (!current()) return;
      setRenaming(null);
      toast.success('项目名称已更新');
    } catch (reason) {if (current()) toast.error('修改失败', {description: errorMessage(reason)});}
    finally {if (current()) setSaving(false);}
  };
  return <section id="projects" className="project-gallery" aria-label="我的项目">
    <div className="project-gallery-heading">
      <div><span className="project-gallery-eyebrow">YOUR WORKSPACE</span><h1>我的项目<span>{loading ? '—' : projects.length}</span></h1><p>让每一个好想法，都有下一步。</p></div>
      <Button className="project-create-button" onClick={onCreate}><Plus size={17}/>新建项目</Button>
    </div>
    <div className="project-gallery-toolbar">
      <div className="project-gallery-tabs" role="group" aria-label="筛选项目">
        <button type="button" aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>全部项目</button>
        <button type="button" aria-pressed={filter === 'favorites'} onClick={() => setFilter('favorites')} title="收藏保存在当前浏览器，按账号区分"><Star size={14}/>已收藏{favoriteCount > 0 && <span>{favoriteCount}</span>}</button>
      </div>
      <div className="project-gallery-tools">
        <div className="project-search"><Search size={16}/><input aria-label="搜索项目" placeholder="搜索项目…" value={query} onChange={event => setQuery(event.target.value)}/>{query && <button aria-label="清空搜索" onClick={() => setQuery('')}><X size={13}/></button>}</div>
        <label className="project-sort"><ArrowDownWideNarrow size={15}/><select aria-label="项目排序" value={sort} onChange={event => setSort(event.target.value)}><option value="updated">最近更新</option><option value="created">最近创建</option><option value="name">项目名称</option></select></label>
        <button type="button" className="project-refresh" aria-label="刷新项目列表" title="刷新项目列表" disabled={refreshing} onClick={onRefresh}><RefreshCw size={16} className={refreshing ? 'animate-spin' : ''}/></button>
      </div>
    </div>
    {error && <div className="project-gallery-error" role="alert"><span>{error}</span><button onClick={onRefresh}>重新加载</button></div>}
    {loading ? <div className="project-gallery-grid" aria-label="正在加载项目">{[0, 1, 2].map(id => <div className="project-tile project-tile-skeleton" key={id}><Skeleton className="project-skeleton-cover"/><Skeleton className="mx-5 mt-5 h-4 w-1/2"/><Skeleton className="mx-5 mb-6 mt-3 h-3 w-1/3"/></div>)}</div> : filtered.length ? <div className="project-gallery-grid">
      {filtered.map(project => <article className="project-tile" key={project.id}>
        <Cover project={project}/>
        <button type="button" className={`project-favorite ${favorites.includes(project.id) ? 'is-favorite' : ''}`} aria-label={`${favorites.includes(project.id) ? '取消收藏' : '收藏'}：${project.name}`} aria-pressed={favorites.includes(project.id)} onClick={() => toggleFavorite(project)}><Star size={16} fill={favorites.includes(project.id) ? 'currentColor' : 'none'}/></button>
        <div className="project-tile-details"><Link to={`/p/${project.id}`} className="project-tile-title" title={project.name}>{project.name}</Link>
          <DropdownMenu><DropdownMenuTrigger asChild><button type="button" className="project-actions" aria-label={`项目操作：${project.name}`}><MoreHorizontal size={20}/></button></DropdownMenuTrigger><DropdownMenuContent align="end" className="w-44">
            <DropdownMenuItem asChild><Link to={`/p/${project.id}`}><ArrowUpRight className="mr-2 h-4 w-4"/>打开项目</Link></DropdownMenuItem>
            <DropdownMenuItem onClick={() => toggleFavorite(project)}><Star className="mr-2 h-4 w-4"/>{favorites.includes(project.id) ? '取消收藏' : '收藏项目'}</DropdownMenuItem>
            <DropdownMenuItem disabled={project.role === 'viewer'} onClick={() => {setRenaming(project); setName(project.name);}}><Pencil className="mr-2 h-4 w-4"/>重命名</DropdownMenuItem>
            <DropdownMenuSeparator/><DropdownMenuItem disabled={!!project.role && project.role !== 'owner'} className="text-destructive focus:text-destructive" onClick={() => onDelete(project)}><Trash2 className="mr-2 h-4 w-4"/>删除项目</DropdownMenuItem>
          </DropdownMenuContent></DropdownMenu>
          <div className="project-tile-meta"><time dateTime={project.updated_at}>{projectDate(project.updated_at)}</time><span className="project-tile-meta-dot">·</span><span>{project.agent_mode === 'team' ? '团队项目' : '工程师项目'}</span>{project.is_public && <span className="project-shared" title="已开启分享"><Globe size={12}/>已分享</span>}</div>
        </div>
      </article>)}
    </div> : !error && <div className="project-gallery-empty"><span className="project-empty-icon">{query ? <Search/> : filter === 'favorites' ? <Star/> : <FolderOpen/>}</span><h2>{query ? '还没有找到这个项目' : filter === 'favorites' ? '把常用项目，留在手边' : '你的下一个作品，从这里开始'}</h2><p>{query ? '试试其他关键词，或查看全部项目。' : filter === 'favorites' ? '点击项目卡片上的星标，即可在这里快速找到它。收藏保存在当前浏览器。' : '从一个小灵感开始，和智能体一起把它变成真实的应用。'}</p>{query || filter === 'favorites' ? <Button variant="outline" onClick={() => {setQuery(''); setFilter('all');}}>查看全部项目</Button> : <Button className="project-create-button" onClick={onCreate}><Plus size={16}/>创建第一个项目</Button>}</div>}
    {!loading && filtered.length > 0 && <div className="project-gallery-footnote"><span><Check size={12}/>作品与版本已安全保存</span><span>{query || filter !== 'all' ? `显示 ${filtered.length} / ${projects.length} 个项目` : `${projects.length} 个项目，持续生长中`}</span></div>}
    <Dialog open={!!renaming} onOpenChange={open => {if (!open && !saving) setRenaming(null);}}><DialogContent className="sm:max-w-md"><DialogHeader><DialogTitle>给项目一个好名字</DialogTitle><DialogDescription>更新名称，方便你和伙伴找到这个项目。</DialogDescription></DialogHeader><form onSubmit={event => {event.preventDefault(); void rename();}}><label className="text-sm font-medium" htmlFor="project-name">项目名称</label><input id="project-name" className="mt-2 w-full rounded-lg border bg-background px-3 py-2.5 text-sm outline-none focus:border-primary" autoFocus maxLength={120} value={name} disabled={saving} onChange={event => setName(event.target.value)}/><DialogFooter className="mt-6"><Button type="button" variant="outline" disabled={saving} onClick={() => setRenaming(null)}>取消</Button><Button type="submit" disabled={saving || !name.trim()}>{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin"/>}保存名称</Button></DialogFooter></form></DialogContent></Dialog>
  </section>;
}
