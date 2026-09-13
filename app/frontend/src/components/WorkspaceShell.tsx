import {useState, type ReactNode, type Ref} from 'react';
import {Link, useLocation} from 'react-router-dom';
import {BookOpen, FolderOpen, Home, Lightbulb, MessageSquare, PanelLeftClose, PanelLeftOpen, Settings2, Users} from 'lucide-react';
import {AccountMenu, BrandMark, TopBar} from '@/components/AppShell';
import {Button} from '@/components/ui/button';
import {readToken, type AfUser, type AuthState} from '@/lib/sdk';
import {useProjects} from '@/hooks/useProjects';
import '@/styles/conversation-studio.css';
import '@/styles/workspace-shell.css';

export const WORKSPACE_SECTIONS = [
  {id:'home', label:'开启新项目', Icon:Home},
  {id:'projects', label:'我的项目', Icon:FolderOpen},
  {id:'inspiration', label:'灵感', Icon:Lightbulb},
  {id:'notes', label:'创作小贴士', Icon:BookOpen},
] as const;
export type WorkspaceSection = typeof WORKSPACE_SECTIONS[number]['id'];

interface Props {
  authState: AuthState;
  user?: AfUser | null;
  children: ReactNode;
  title?: string;
  headerAction?: ReactNode;
  className?: string;
  mainClassName?: string;
  contentRef?: Ref<HTMLElement>;
  onSelectSection?: (section: WorkspaceSection) => void;
}

export default function WorkspaceShell({authState, user, children, title, headerAction, className = '', mainClassName = '', contentRef, onSelectSection}: Props) {
  const location = useLocation();
  const {projects: collection, loading, error, refresh} = useProjects(authState, user);
  const [collapsed, setCollapsed] = useState(() => {
    try {return localStorage.getItem('atomforge:sidebar-collapsed') === 'true';}
    catch {return false;}
  });
  const toggleSidebar = () => {
    setCollapsed(previous => {
      const next = !previous;
      try {localStorage.setItem('atomforge:sidebar-collapsed', String(next));} catch { /* Navigation works without browser storage. */ }
      return next;
    });
  };
  const requestedSection = new URLSearchParams(location.search).get('view');
  const activeSection = location.pathname === '/dashboard' ? WORKSPACE_SECTIONS.find(section => section.id === requestedSection)?.id || 'home' : '';
  // Keep navigation in place while an existing session is checked on a route
  // change, including projects already loaded by this same session.
  const showWorkspace = authState === 'authenticated' || (authState === 'loading' && !!user && !!readToken());
  if (!showWorkspace) return <div className={`workspace-public ${className}`}><TopBar authState={authState} user={user} brandTo="/dashboard"/>{children}</div>;
  return <div className={`conversation-studio workspace-shell ${collapsed ? 'sidebar-collapsed' : ''} ${className}`}>
    <aside className="conversation-sidebar" aria-label="工作室侧边栏">
      <div className="sidebar-brand-row"><BrandMark to="/dashboard"/><Button variant="ghost" size="icon" className="sidebar-toggle" aria-label={collapsed ? '展开侧边栏' : '折叠侧边栏'} aria-expanded={!collapsed} aria-controls="studio-navigation" title={collapsed ? '展开侧边栏' : '折叠侧边栏'} onClick={toggleSidebar}>{collapsed ? <PanelLeftOpen className="h-4 w-4"/> : <PanelLeftClose className="h-4 w-4"/>}</Button></div>
      <nav id="studio-navigation" className="sidebar-navigation" aria-label="工作室导航">{WORKSPACE_SECTIONS.map(({id,label,Icon}) => <Link key={id} to={id === 'home' ? '/dashboard' : `/dashboard?view=${id}`} title={label} aria-label={label} aria-current={activeSection === id ? 'page' : undefined} onClick={event => {if (onSelectSection && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey && event.button === 0) {event.preventDefault();onSelectSection(id);}}}><Icon className="h-[18px] w-[18px]"/><span>{label}</span>{id === 'projects' && !loading && <small>{collection.length}</small>}</Link>)}</nav>
      <div className="sidebar-recent"><p>最近项目</p>{loading ? <span className="sidebar-hint">正在加载…</span> : collection.length ? collection.slice(0,6).map(project => <Link key={project.id} title={project.name} to={`/p/${project.id}`}><MessageSquare className="h-3.5 w-3.5"/><span>{project.name}</span></Link>) : !error && <span className="sidebar-hint">从第一个想法开始</span>}{error && <button className="sidebar-retry" title={error} onClick={refresh}>加载失败，点击重试</button>}</div>
      <div className="sidebar-bottom"><Link to="/agents" title="我的团队" aria-label="我的团队" aria-current={location.pathname === '/agents' ? 'page' : undefined}><Users className="h-[18px] w-[18px]"/><span>我的团队</span></Link><Link to="/settings" title="生成设置" aria-label="生成设置" aria-current={location.pathname === '/settings' ? 'page' : undefined}><Settings2 className="h-[18px] w-[18px]"/><span>生成设置</span></Link><div className="sidebar-account"><AccountMenu user={user}/></div></div>
    </aside>
    <main ref={contentRef} className={`conversation-main ${mainClassName}`}>
      {(title || headerAction) && <header className="conversation-page-heading"><span>{title}</span>{headerAction}</header>}
      {children}
    </main>
  </div>;
}
