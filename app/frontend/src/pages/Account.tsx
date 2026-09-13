import {useRef, useState} from 'react';
import {Camera, Check, Loader2, RotateCcw, Upload} from 'lucide-react';
import {toast} from 'sonner';
import {LoginGate, useAuth} from '@/components/AppShell';
import WorkspaceShell from '@/components/WorkspaceShell';
import AccountAvatar from '@/components/AccountAvatar';
import ExternalAccounts from '@/components/ExternalAccounts';
import UsernameField from '@/components/UsernameField';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Label} from '@/components/ui/label';
import {Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger} from '@/components/ui/dialog';
import {errorMessage, updateAccount, type AfUser} from '@/lib/sdk';

function ProfileEditor({user}: {user: AfUser}) {
  const [username, setUsername] = useState(user.username || user.display_name);
  const [email, setEmail] = useState(user.email);
  const [avatar, setAvatar] = useState<string | undefined>();
  const [reading, setReading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  const image = avatar === undefined ? user.avatar_url : avatar;
  const dirty = username !== (user.username || user.display_name) || email !== user.email || avatar !== undefined;

  const chooseAvatar = async (file?: File) => {
    if (!file) return;
    setError('');
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {setError('请选择 PNG、JPG 或 WebP 图片'); return;}
    if (file.size > 1024 * 1024) {setError('头像图片不能超过 1 MB'); return;}
    setReading(true);
    try {
      const data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error('图片读取失败，请重新选择'));
        reader.readAsDataURL(file);
      });
      await new Promise<void>((resolve, reject) => {
        const preview = new Image();
        preview.onload = () => Math.max(preview.width, preview.height) <= 4096 ? resolve() : reject(new Error('图片宽高不能超过 4096 像素'));
        preview.onerror = () => reject(new Error('图片无法读取，请重新选择'));
        preview.src = data;
      });
      setAvatar(data);
    } catch (error) {setError(errorMessage(error));}
    finally {setReading(false);}
  };
  const reset = () => {
    setUsername(user.username || user.display_name); setEmail(user.email); setAvatar(undefined); setError('');
  };
  const save = async (event: React.FormEvent) => {
    event.preventDefault(); setSaving(true); setError('');
    try {
      const saved = await updateAccount({username: username.trim(), email: email.trim(), ...(avatar !== undefined ? {avatar} : {})});
      setUsername(saved.username || saved.display_name); setEmail(saved.email); setAvatar(undefined);
      toast.success('个人资料已保存');
    } catch (error) {setError(errorMessage(error));}
    finally {setSaving(false);}
  };
  return <form onSubmit={save} className="overflow-hidden rounded-2xl border bg-card shadow-sm">
    <div className="border-b bg-gradient-to-r from-primary/5 to-background p-6 sm:p-8">
      <div className="flex flex-wrap items-center gap-5">
        <Dialog>
          <DialogTrigger asChild><button type="button" aria-label="预览头像" className="group relative rounded-full ring-4 ring-background focus-visible:outline-none focus-visible:ring-primary">
            <AccountAvatar src={image} name={username || '我'} className="h-24 w-24 text-3xl"/>
            <span className="absolute bottom-0 right-0 rounded-full border bg-background p-1.5 shadow-sm"><Camera className="h-4 w-4 text-muted-foreground"/></span>
          </button></DialogTrigger>
          <DialogContent className="max-w-sm"><DialogHeader><DialogTitle>头像预览</DialogTitle><DialogDescription>{avatar !== undefined ? '这是待保存的头像，保存资料后生效。' : '当前使用的头像。'}</DialogDescription></DialogHeader>
            <AccountAvatar src={image} name={username || '我'} className="mx-auto my-4 h-60 w-60 text-7xl"/>
          </DialogContent>
        </Dialog>
        <div className="min-w-0 flex-1 space-y-3">
          <div><h2 className="text-sm font-semibold">个人头像</h2><p className="mt-1 text-xs leading-5 text-muted-foreground">支持 PNG、JPG、WebP，最大 1 MB。图片居中裁切，点击头像可预览。</p></div>
          <div className="flex flex-wrap gap-2">
            <input ref={fileInput} aria-label="选择头像文件" type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" tabIndex={-1} disabled={saving || reading} onChange={e => {void chooseAvatar(e.target.files?.[0]); e.target.value = '';}}/>
            <Button type="button" variant="outline" size="sm" disabled={saving || reading} onClick={() => fileInput.current?.click()}>{reading ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <Upload className="mr-2 h-4 w-4"/>}{image ? '更换头像' : '上传头像'}</Button>
            {image && <Button type="button" variant="ghost" size="sm" disabled={saving || reading} onClick={() => setAvatar('')}>移除头像</Button>}
          </div>
        </div>
      </div>
    </div>
    <div className="space-y-5 p-6 sm:p-8">
      <UsernameField value={username} onChange={setUsername} disabled={saving}/>
      <div className="space-y-1.5"><Label htmlFor="account-email">绑定邮箱</Label><Input id="account-email" type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} maxLength={190} disabled={saving} required/><p className="text-xs leading-5 text-muted-foreground">用户名和邮箱属于同一个账号，两者均可登录。修改后请使用新的用户名或邮箱。</p></div>
      {error && <p role="alert" className="rounded-lg border border-destructive/25 bg-destructive/5 p-3 text-sm text-destructive">{error}</p>}
      <div className="flex flex-wrap items-center gap-3 border-t pt-5">
        <Button type="submit" disabled={!dirty || saving || reading}>{saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <Check className="mr-2 h-4 w-4"/>}{saving ? '正在保存…' : '保存资料'}</Button>
        <Button type="button" variant="ghost" disabled={!dirty || saving || reading} onClick={reset}><RotateCcw className="mr-2 h-3.5 w-3.5"/>取消修改</Button>
        <span role="status" className="text-xs text-muted-foreground">{dirty ? '有未保存的修改' : '资料已同步'}</span>
      </div>
    </div>
  </form>;
}

export default function Account() {
  const {authState, user} = useAuth();
  return <WorkspaceShell authState={authState} user={user} title="个人中心">
    {authState === 'loading' ? <div className="flex justify-center gap-2 py-20 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin"/>正在加载个人资料…</div> : !user ? <LoginGate title="登录后管理个人资料" description="修改用户名、绑定邮箱和个人头像。"/> : <div className="mx-auto max-w-2xl px-4 py-8 sm:py-12">
      <h1 className="text-2xl font-semibold tracking-tight">个人中心</h1><p className="mb-7 mt-2 text-sm text-muted-foreground">管理你的账号资料，让团队更容易认出你。</p>
      <ProfileEditor key={user.id} user={user}/>
      <div className="mt-8 rounded-2xl border bg-card p-6"><ExternalAccounts/></div>
    </div>}
  </WorkspaceShell>;
}
