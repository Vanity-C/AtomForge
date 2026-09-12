import {useEffect, useState} from 'react';
import {CheckCircle2, Loader2} from 'lucide-react';
import {Input} from '@/components/ui/input';
import {Label} from '@/components/ui/label';
import {errorMessage, invoke, readToken} from '@/lib/sdk';

export const USERNAME_HELP = '2–40 位中文、英文字母、数字、下划线、点或短横线；不区分英文大小写。';

export default function UsernameField({value, onChange, disabled = false,compact=false}: {value: string; onChange: (value: string) => void; disabled?: boolean;compact?:boolean}) {
  const [check, setCheck] = useState<{value: string; state: 'checking' | 'available' | 'error'; message: string} | null>(null);
  useEffect(() => {
    if (!value.trim()) return;
    let live = true;
    const timer = setTimeout(async () => {
      setCheck({value, state: 'checking', message: '正在检查用户名…'});
      try {
        const result = await invoke<{available: boolean}>({url: '/api/v1/af-auth/username-availability?username=' + encodeURIComponent(value), auth: !!readToken()});
        if (live) setCheck({value, state: result.available ? 'available' : 'error', message: result.available ? '该用户名可以使用' : '该用户名已被占用，请换一个'});
      } catch (error) {
        if (live) setCheck({value, state: 'error', message: errorMessage(error)});
      }
    }, 400);
    return () => {live = false; clearTimeout(timer);};
  }, [value]);
  const current = check?.value === value ? check : null;
  return <div className="space-y-1.5">
    <Label htmlFor="account-username">用户名</Label>
    <Input id="account-username" value={value} onChange={e => onChange(e.target.value)} placeholder="设置你的唯一用户名" autoComplete="username" maxLength={40} disabled={disabled} aria-describedby="username-help username-status" aria-invalid={current?.state === 'error'} required/>
    <p id="username-help" className="text-xs leading-5 text-muted-foreground">{USERNAME_HELP}</p>
    <p id="username-status" role="status" className={`flex ${compact&&!current?'':'min-h-5'} items-center gap-1 text-xs ${current?.state === 'error' ? 'text-destructive' : 'text-muted-foreground'}`}>
      {current?.state === 'checking' && <Loader2 className="h-3 w-3 animate-spin"/>}
      {current?.state === 'available' && <CheckCircle2 className="h-3 w-3 text-emerald-600"/>}
      {current?.message}
    </p>
  </div>;
}
