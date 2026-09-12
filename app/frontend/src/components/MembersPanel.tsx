import StudioSelect from '@/components/StudioSelect';
import {useEffect,useState} from 'react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {invoke,errorMessage} from '@/lib/sdk';
import {studioUrl} from '@/lib/studio';
import {toast} from 'sonner';
export default function MembersPanel({projectId}:{projectId:number}){
  const [data,setData]=useState<{can_manage:boolean;items:{id:number;email:string;role:string}[]}>();
  const [email,setEmail]=useState('');const [role,setRole]=useState('viewer');
  const load=()=>invoke<typeof data>({url:studioUrl(projectId,'members')}).then(setData).catch(e=>toast.error(errorMessage(e)));
  useEffect(()=>{void load();},[projectId]); // eslint-disable-line react-hooks/exhaustive-deps
  const mutate=async(method:'POST'|'DELETE',suffix='')=>{try{await invoke({url:studioUrl(projectId,'members'+suffix),method,data:{email,role}});setEmail('');await load();}catch(e){toast.error(errorMessage(e));}};
  return <div className="border-t pt-4"><h3 className="font-semibold">项目成员</h3><p className="my-2 text-xs text-muted-foreground">通过已注册邮箱添加成员，无需发送邮件。编辑者可修改代码和生成应用；发布和云服务配置由所有者管理。</p>
    {data?.items.map(m=><div key={m.id} className="my-2 flex justify-between text-xs"><span>{m.email} · {m.role==='editor'?'编辑者':'查看者'}</span>{data.can_manage&&<button className="text-destructive" onClick={()=>void mutate('DELETE','/'+m.id)}>移除</button>}</div>)}
    {data?.can_manage&&<div className="space-y-2"><Input placeholder="成员的注册邮箱" value={email} onChange={e=>setEmail(e.target.value)}/><StudioSelect aria-label="成员权限" value={role} onValueChange={setRole} options={[{value:"viewer",label:"查看者",description:"查看项目与运行预览"},{value:"editor",label:"编辑者",description:"编辑源码、运行与修改项目"}]}/><Button variant="outline" disabled={!email.trim()} onClick={()=>void mutate('POST')}>添加 / 更新成员</Button></div>}
  </div>;
}
