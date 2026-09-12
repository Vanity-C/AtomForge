/**
 * AtomForge's own sign-in / sign-up page.
 *
 * Accounts belong to AtomForge itself (stored in this app's own database), so
 * this page fully replaces the previous platform login redirect. Registration
 * signs the user in immediately - there is no email confirmation step.
 */
import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Atom, Eye, EyeOff, Loader2, LogIn, ShieldCheck, UserPlus } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import UsernameField from '@/components/UsernameField';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  cachedUser,
  errorMessage,
  fetchCurrentUser,
  register,
  signIn,
  readToken,
} from '@/lib/sdk';

type Mode = 'login' | 'register';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function Auth() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const redirectTo = searchParams.get('redirect') || '/dashboard';
  const initialMode: Mode = searchParams.get('mode') === 'register' ? 'register' : 'login';

  const [mode, setMode] = useState<Mode>(initialMode);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [checking, setChecking] = useState(true);

  // Already signed in? Skip the form entirely.
  useEffect(() => {
    let mounted = true;
    if (!readToken() && !cachedUser()) {
      setChecking(false);
      return () => {
        mounted = false;
      };
    }
    fetchCurrentUser().then((user) => {
      if (!mounted) return;
      if (user) {
        navigate(redirectTo, { replace: true });
        return;
      }
      setChecking(false);
    });
    return () => {
      mounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const validate = (): string => {
    const cleanEmail = email.trim();
    if (!cleanEmail) return mode === 'login' ? '请填写用户名或邮箱' : '请填写邮箱';
    if (mode === 'register' && !EMAIL_RE.test(cleanEmail)) return '邮箱格式不正确';
    if (!password) return '请填写密码';
    if (mode === 'register') {
      if (!displayName.trim()) return '请填写用户名';
      if (password.length < 8) return '密码至少需要 8 位字符';
      if (!/[a-zA-Z]/.test(password) || !/\d/.test(password)) {
        return '密码需要同时包含字母和数字';
      }
    }
    return '';
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const message = validate();
    if (message) {
      setError(message);
      return;
    }
    setError('');
    setSubmitting(true);
    try {
      if (mode === 'register') {
        // The backend returns a session token, so a new account lands straight
        // in the workspace without any extra confirmation step.
        await register({
          email: email.trim(),
          password,
          displayName: displayName.trim(),
        });
        toast.success('注册成功', { description: '已自动登录，开始创建你的第一个项目吧。' });
        navigate(redirectTo, { replace: true });
        return;
      }
      await signIn(email.trim(), password);
      toast.success('登录成功');
      navigate(redirectTo, { replace: true });
    } catch (err) {
      const detail = errorMessage(err, mode === 'register' ? '注册失败' : '登录失败');
      setError(detail);
    } finally {
      setSubmitting(false);
    }
  };

  const switchMode = (next: Mode) => {
    if (submitting) return;
    setMode(next);
    setError('');
    setPassword('');
  };

  if (checking) {
    return (
      <div className="flex min-h-screen items-center justify-center gap-2 bg-background text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        正在检查登录状态…
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="flex h-14 shrink-0 items-center border-b border-border bg-card px-4">
        <Link to="/" className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <Atom className="h-4 w-4" />
          </span>
          <span className="text-sm font-bold tracking-tight">AtomForge</span>
        </Link>
      </header>

      <main className="flex flex-1 items-center justify-center px-4 py-12">
        <div className="w-full max-w-md">
          <div className="rounded-lg border border-border bg-card p-7 shadow-sm">
            <h1 className="text-xl font-bold tracking-tight">
              {mode === 'login' ? '登录 AtomForge' : '创建 AtomForge 账号'}
            </h1>
            <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
              {mode === 'login'
                ? '登录后即可继续迭代你的项目，代码与对话记录都在你的账号下。'
                : '注册一个 AtomForge 账号，项目、代码与版本历史都会保存在你名下。'}
            </p>

            <Tabs
              value={mode}
              onValueChange={(value) => switchMode(value as Mode)}
              className="mt-5"
            >
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="login" className="text-xs" disabled={submitting}>
                  登录
                </TabsTrigger>
                <TabsTrigger value="register" className="text-xs" disabled={submitting}>
                  注册
                </TabsTrigger>
              </TabsList>
            </Tabs>

            <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
              {mode === 'register' && <UsernameField value={displayName} onChange={setDisplayName} disabled={submitting}/>}

              <div className="space-y-1.5">
                <Label htmlFor="email" className="text-sm">
                  {mode === 'login' ? '用户名或邮箱' : '邮箱'}
                </Label>
                <Input
                  id="email"
                  type={mode === 'login' ? 'text' : 'email'}
                  value={email}
                  autoComplete={mode === 'login' ? 'username' : 'email'}
                  placeholder={mode === 'login' ? '输入用户名或邮箱' : 'you@example.com'}
                  maxLength={190}
                  disabled={submitting}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="password" className="text-sm">
                  密码
                </Label>
                <div className="relative">
                  <Input
                    id="password"
                    disabled={submitting}
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                    placeholder={mode === 'register' ? '至少 8 位，含字母和数字' : '请输入密码'}
                    maxLength={128}
                    className="pr-10"
                    onChange={(e) => setPassword(e.target.value)}
                  />
                  <button
                    type="button"
                    aria-label={showPassword ? '隐藏密码' : '显示密码'}
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground transition-colors duration-200 hover:md:text-foreground"
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                {mode === 'register' ? (
                  <p className="text-xs text-muted-foreground">
                    请使用至少 8 位的字母与数字组合。
                  </p>
                ) : null}
              </div>

              {error ? (
                <div role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                  {error}
                </div>
              ) : null}

              <Button type="submit" className="w-full gap-2" disabled={submitting}>
                {submitting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : mode === 'login' ? (
                  <LogIn className="h-4 w-4" />
                ) : (
                  <UserPlus className="h-4 w-4" />
                )}
                {submitting
                  ? mode === 'login'
                    ? '正在登录…'
                    : '正在创建账号…'
                  : mode === 'login'
                    ? '登录'
                    : '注册并登录'}
              </Button>
            </form>

            <div className="mt-4 text-center text-sm text-muted-foreground">
              {mode === 'login' ? (
                <>
                  还没有账号？
                  <button
                    type="button"
                    className="ml-1 font-medium text-primary hover:md:underline"
                    onClick={() => switchMode('register')}
                  >
                    立即注册
                  </button>
                </>
              ) : (
                <>
                  已经有账号？
                  <button
                    type="button"
                    className="ml-1 font-medium text-primary hover:md:underline"
                    onClick={() => switchMode('login')}
                  >
                    直接登录
                  </button>
                </>
              )}
            </div>
          </div>

          <div className="mt-4 flex items-start gap-2.5 rounded-lg border border-border bg-card px-4 py-3">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-success" />
            <p className="text-xs leading-relaxed text-muted-foreground">
              用户名和邮箱均可登录同一个账号。登录后，可以在个人中心更新用户名、绑定邮箱和头像。
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}
