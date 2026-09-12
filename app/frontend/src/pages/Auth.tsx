/**
 * AtomForge's own sign-in / sign-up page.
 *
 * Accounts belong to AtomForge itself (stored in this app's own database), so
 * this page fully replaces the previous platform login redirect. Registration
 * signs the user in immediately - there is no email confirmation step.
 */
import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowRight, Eye, EyeOff, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import UsernameField from '@/components/UsernameField';
import ExternalAccounts from '@/components/ExternalAccounts';
import AuthShell from '@/components/AuthShell';
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
  const requestedRedirect=searchParams.get('redirect')||'/dashboard';
  const redirectTo=requestedRedirect.startsWith('/')&&!requestedRedirect.startsWith('//')&&!requestedRedirect.includes('\\')?requestedRedirect:'/dashboard';
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
    }).catch(()=>{if(mounted){setChecking(false);setError('暂时无法检查登录状态，请重新登录。');}});
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
    setShowPassword(false);
    if(next==='register'&&!EMAIL_RE.test(email.trim()))setEmail('');
  };

  if (checking) return <AuthShell><p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin"/>正在检查登录状态…</p></AuthShell>;

  return <AuthShell>
    <div className="auth-form-heading"><span className="auth-wordmark">AtomForge</span><h1>{mode==='login'?'欢迎回来':'开启你的创作'}</h1><p>{mode==='login'?'登录或注册，让好想法接着发生。':'创建账号，和你的专属团队做点新东西。'}</p></div>
    <ExternalAccounts login redirect={redirectTo}/>
    <div className="auth-divider">或使用{mode==='login'?'邮箱账号':'邮箱注册'}</div>
    <form className="auth-form" onSubmit={handleSubmit}>
      {mode==='register'&&<UsernameField value={displayName} onChange={setDisplayName} disabled={submitting} compact/>}
      <div className="space-y-2"><Label htmlFor="email">{mode==='login'?'用户名或邮箱':'邮箱'}</Label><Input id="email" type={mode==='login'?'text':'email'} value={email} autoComplete={mode==='login'?'username':'email'} placeholder={mode==='login'?'输入你的用户名或邮箱':'you@example.com'} maxLength={190} disabled={submitting} onChange={e=>setEmail(e.target.value)} required/></div>
      <div className="space-y-2"><Label htmlFor="password">密码</Label><div className="relative"><Input id="password" disabled={submitting} type={showPassword?'text':'password'} value={password} autoComplete={mode==='login'?'current-password':'new-password'} placeholder={mode==='register'?'至少 8 位，包含字母和数字':'输入你的密码'} maxLength={128} className="pr-11" onChange={e=>setPassword(e.target.value)} required/><button type="button" aria-label={showPassword?'隐藏密码':'显示密码'} onClick={()=>setShowPassword(v=>!v)} className="auth-password-toggle">{showPassword?<EyeOff size={16}/>:<Eye size={16}/>}</button></div></div>
      {error&&<div role="alert" className="rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-xs leading-5 text-destructive">{error}</div>}
      <Button type="submit" className="auth-submit w-full gap-2" disabled={submitting}>{submitting?<><Loader2 className="h-4 w-4 animate-spin"/>{mode==='login'?'正在登录…':'正在创建账号…'}</>:<>{mode==='login'?'登录':'创建账号'}<ArrowRight size={15}/></>}</Button>
    </form>
    <div className="auth-switch">{mode==='login'?'第一次来到这里？':'已经有账号？'}<button type="button" disabled={submitting} onClick={()=>switchMode(mode==='login'?'register':'login')}>{mode==='login'?'创建账号':'直接登录'}</button></div>
  </AuthShell>;
}
