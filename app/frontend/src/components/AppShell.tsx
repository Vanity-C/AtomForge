/**
 * Shared top bar, auth hook and page shell.
 *
 * Auth state comes from AtomForge's own account system.
 */
import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Atom, LayoutGrid, LogOut, Settings2, User, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import AccountAvatar from '@/components/AccountAvatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  cachedUser,
  fetchCurrentUser,
  onAuthChange,
  readToken,
  signOut,
  type AfUser,
  type AuthState,
} from '@/lib/sdk';

/**
 * Resolve the AtomForge session once per page and keep it in sync with
 * sign-in / sign-out events so a refresh restores the logged-in state.
 */
export function useAuth() {
  const [authState, setAuthState] = useState<AuthState>('loading');
  const [user, setUser] = useState<AfUser | null>(cachedUser());

  useEffect(() => {
    let mounted = true;
    const unsubscribe = onAuthChange((next) => {
      if (!mounted) return;
      setUser(next);
      setAuthState(next ? 'authenticated' : 'anonymous');
    });

    if (!readToken()) {
      setUser(null);
      setAuthState('anonymous');
      return () => {
        mounted = false;
        unsubscribe();
      };
    }

    fetchCurrentUser().then((resolved) => {
      if (!mounted) return;
      setUser(resolved);
      setAuthState(resolved ? 'authenticated' : 'anonymous');
    });

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  return { authState, user };
}

/** Navigate to AtomForge's own auth page, remembering where to return. */
export function useGoToAuth() {
  const navigate = useNavigate();
  const location = useLocation();
  return (mode: 'login' | 'register' = 'login') => {
    const redirect = encodeURIComponent(`${location.pathname}${location.search}`);
    navigate(`/auth?mode=${mode}&redirect=${redirect}`);
  };
}

export function BrandMark({ to = '/' }: { to?: string }) {
  return (
    <Link to={to} className="studio-brand" aria-label="AtomForge">
      <span className="studio-brand-icon"><svg viewBox="0 0 28 28" fill="none" aria-hidden="true"><path d="M4 23 12 5h5l-8 18H4Zm9-11 5 11h6L16 5" fill="currentColor"/><path d="m10 18 10 2" stroke="currentColor" strokeWidth="3"/></svg></span>
      <span>AtomForge<span className="studio-brand-period">.</span></span>
    </Link>
  );
}

export interface TopBarProps {
  authState: AuthState;
  user?: AfUser | null;
  center?: React.ReactNode;
  right?: React.ReactNode;
  brandTo?: string;
}

export function TopBar({ authState, user, center, right, brandTo = '/' }: TopBarProps) {
  const goToAuth = useGoToAuth();
  const location = useLocation();


  return (
    <header className={`studio-topbar flex shrink-0 items-center gap-3 border-b border-border bg-card px-4 ${right ? 'min-h-14 flex-wrap py-2 sm:h-14 sm:flex-nowrap sm:py-0' : 'h-14'}`}>
      <BrandMark to={brandTo} />
      {center ? <div className="flex min-w-0 flex-1 items-center gap-2">{center}</div> : <div className="flex flex-1 justify-center">{authState==='authenticated'&&!right&&<nav className="studio-main-nav" aria-label="工作室导航">{[['/dashboard','工作室'],['/agents','我的团队'],['/settings','生成设置']].map(([to,label])=><Link key={to} to={to} aria-current={location.pathname===to?'page':undefined}>{label}</Link>)}</nav>}</div>}
      <div className={`flex shrink-0 items-center gap-2 ${right ? 'w-full justify-end sm:w-auto' : ''}`}>
        {right}
        {authState === 'authenticated' ? (
          <AccountMenu user={user}/>
        ) : authState === 'anonymous' ? (
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-8 px-3 text-xs"
              onClick={() => goToAuth('login')}
            >
              登录
            </Button>
            <Button size="sm" className="h-8 px-3 text-xs" onClick={() => goToAuth('register')}>
              注册
            </Button>
          </div>
        ) : (
          <div className="h-8 w-16 animate-pulse rounded-md bg-muted" />
        )}
      </div>
    </header>
  );
}

export function AccountMenu({user}: {user?: AfUser | null}) {
  const navigate = useNavigate();
  const handleSignOut = async () => {
    await signOut();
    navigate('/', { replace: true });
  };
  return (
<DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="h-9 max-w-40 gap-2 rounded-full px-1.5 sm:pr-3" aria-label="账户菜单">
                <AccountAvatar src={user?.avatar_url} name={user?.username || user?.display_name || '我'} className="h-7 w-7"/>
                <span className="max-w-20 truncate text-xs sm:max-w-28">{user?.username || user?.display_name}</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              {user?.display_name ? (
                <>
                  <DropdownMenuLabel className="truncate text-xs font-normal text-muted-foreground">
                    {user.username || user.display_name}
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                </>
              ) : null}
              <DropdownMenuItem onClick={() => navigate('/account')}>
                <User className="mr-2 h-4 w-4" />
                个人中心
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => navigate('/dashboard?view=projects')}>
                <LayoutGrid className="mr-2 h-4 w-4" />
                我的项目
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => navigate('/settings')}>
                <Settings2 className="mr-2 h-4 w-4" />
                生成设置
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => navigate('/agents')}>
                <Users className="mr-2 h-4 w-4" />智能体管理
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={handleSignOut}>
                <LogOut className="mr-2 h-4 w-4" />
                退出登录
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
  );
}

export function LoginGate({ title, description }: { title: string; description: string }) {
  const goToAuth = useGoToAuth();
  return (
    <div className="flex flex-1 items-center justify-center px-6 py-20">
      <div className="w-full max-w-sm rounded-lg border border-border bg-card p-7 shadow-sm">
        <span className="flex h-9 w-9 items-center justify-center rounded-md bg-accent text-accent-foreground">
          <Atom className="h-4 w-4" />
        </span>
        <h2 className="mt-4 text-lg font-semibold">{title}</h2>
        <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{description}</p>
        <Button className="mt-5 w-full" onClick={() => goToAuth('login')}>
          登录 AtomForge
        </Button>
        <Button variant="outline" className="mt-2 w-full" onClick={() => goToAuth('register')}>
          注册新账号
        </Button>
      </div>
    </div>
  );
}
