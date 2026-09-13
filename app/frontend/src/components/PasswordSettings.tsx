import {useState} from 'react';
import {Eye, EyeOff, KeyRound, Loader2} from 'lucide-react';
import {toast} from 'sonner';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Label} from '@/components/ui/label';
import {changePassword, errorMessage, type AfUser} from '@/lib/sdk';

export default function PasswordSettings({user}: {user: AfUser}) {
  const hasPassword = user.has_password !== false;
  const [current, setCurrent] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [visible, setVisible] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (saving) return;
    setError('');
    if (password !== confirm) {setError('两次输入的新密码不一致'); return;}
    if (password.length < 8 || password.length > 128 || !/\p{L}/u.test(password) || !/\p{N}/u.test(password)) {setError('密码需为 8–128 位，且同时包含字母和数字'); return;}
    if (password.trim() !== password) {setError('密码首尾不能包含空格'); return;}
    setSaving(true);
    try {
      await changePassword(current, password);
      setCurrent(''); setPassword(''); setConfirm(''); setVisible(false);
      toast.success(hasPassword ? '密码已修改，其他设备需要重新登录' : '密码已设置，之后也可使用用户名和密码登录');
    } catch (e) {setError(errorMessage(e));}
    finally {setSaving(false);}
  }
  return <form onSubmit={save} className="mt-8 rounded-2xl border bg-card p-6 shadow-sm sm:p-8">
    <div className="mb-6 flex items-start gap-3">
      <div className="rounded-xl bg-primary/10 p-2.5 text-primary"><KeyRound className="h-5 w-5"/></div>
      <div><h2 className="font-semibold">{hasPassword ? '修改密码' : '设置登录密码'}</h2><p className="mt-1 text-xs leading-5 text-muted-foreground">{hasPassword ? '更新 AtomForge 登录密码，保护你的创作空间。' : '你通过第三方账号注册，设置密码后也可使用用户名登录。'}</p></div>
    </div>
    <div className="space-y-4">
      <input type="text" name="username" autoComplete="username" value={user.username || user.display_name} readOnly hidden/>
      {hasPassword && <div className="space-y-1.5"><Label htmlFor="current-password">当前密码</Label><Input id="current-password" type="password" autoComplete="current-password" value={current} onChange={e => setCurrent(e.target.value)} maxLength={200} disabled={saving} required/></div>}
      <div className="space-y-1.5"><Label htmlFor="new-password">新密码</Label><div className="relative"><Input id="new-password" className="pr-11" type={visible ? 'text' : 'password'} autoComplete="new-password" aria-describedby="password-policy" value={password} onChange={e => setPassword(e.target.value)} minLength={8} maxLength={128} disabled={saving} required/><button type="button" aria-label={visible ? '隐藏新密码' : '显示新密码'} aria-pressed={visible} onClick={() => setVisible(!visible)} className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-md text-muted-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">{visible ? <EyeOff size={16}/> : <Eye size={16}/>}</button></div><p id="password-policy" className="text-xs text-muted-foreground">8–128 位，包含字母和数字，首尾不能有空格。</p></div>
      <div className="space-y-1.5"><Label htmlFor="confirm-password">确认新密码</Label><Input id="confirm-password" type={visible ? 'text' : 'password'} autoComplete="new-password" value={confirm} onChange={e => setConfirm(e.target.value)} maxLength={128} disabled={saving} required/></div>
      {error && <p role="alert" className="rounded-lg border border-destructive/25 bg-destructive/5 p-3 text-sm text-destructive">{error}</p>}
      <div className="space-y-3 border-t pt-5"><p className="text-xs leading-5 text-muted-foreground">保存后当前设备保持登录，其他设备的旧登录将失效。第三方账号的密码不受影响。</p><Button disabled={saving || !password || !confirm || (hasPassword && !current)} type="submit">{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin"/>}{saving ? '正在保存…' : hasPassword ? '更新密码' : '设置密码'}</Button></div>
    </div>
  </form>;
}
