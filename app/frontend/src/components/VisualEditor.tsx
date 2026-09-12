import {useState} from 'react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Textarea} from '@/components/ui/textarea';
import {invoke,errorMessage} from '@/lib/sdk';
import {studioUrl} from '@/lib/studio';
import {toast} from 'sonner';
export default function VisualEditor({selection,projectId,version,onClose,onSaved}:{selection:{source:string;text:string|null;tag:string};projectId:number;version:number;onClose:()=>void;onSaved:()=>void}){
  const [text,setText]=useState(selection.text??'');
  const [style,setStyle]=useState<Record<string,string>>({});
  const [busy,setBusy]=useState(false);
  const save=async()=>{setBusy(true);try{await invoke({url:studioUrl(projectId,'visual'),method:'POST',timeoutMs:90000,data:{source:selection.source,version,...(selection.text!==null?{text}:{}),style:Object.fromEntries(Object.entries(style).filter(([,v])=>v.trim()))}});toast.success('已回写源码并通过构建检查');onSaved();}catch(e){toast.error(errorMessage(e));}finally{setBusy(false);}};
  return <div className="fixed bottom-5 right-5 z-50 w-80 rounded-xl border bg-card p-4 shadow-xl">
    <div className="flex items-center justify-between"><h3 className="font-semibold">编辑 {selection.tag}</h3><Button size="sm" variant="ghost" onClick={onClose}>关闭</Button></div>
    <p className="mb-3 truncate font-mono text-xs text-muted-foreground">{selection.source}</p>
    {selection.text!==null?<Textarea value={text} onChange={e=>setText(e.target.value)} aria-label="元素文字"/>:<p className="text-xs text-muted-foreground">此元素含子元素；可修改样式，文字请选取内部元素。</p>}
    <div className="my-3 grid grid-cols-2 gap-2">{[['color','文字颜色'],['backgroundColor','背景颜色'],['fontSize','字号，如 24px'],['padding','内边距，如 16px'],['borderRadius','圆角，如 8px'],['textAlign','对齐，如 center']].map(([key,label])=><Input key={key} aria-label={label} placeholder={label} value={style[key]||''} onChange={e=>setStyle({...style,[key]:e.target.value})}/>)}</div>
    <Button className="w-full" disabled={busy} onClick={()=>void save()}>{busy?'正在构建验证…':'保存到源码'}</Button>
  </div>;
}
