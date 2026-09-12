import {useEffect,useState} from 'react';
import {Button} from '@/components/ui/button';
import {Textarea} from '@/components/ui/textarea';
import {invoke,errorMessage} from '@/lib/sdk';
import {downloadBlob} from '@/lib/zip';
import {toast} from 'sonner';
interface Report{id:string;title:string;body:string;version:number;sources:{id:string;title:string;url:string}[]}
export default function ReportsPanel({projectId}:{projectId:number}){
  const [items,setItems]=useState<Report[]>([]);const [prompt,setPrompt]=useState('');const [busy,setBusy]=useState('');
  const url=`/api/v1/reports/projects/${projectId}`;
  const load=()=>invoke<{items:Report[]}>({url}).then(r=>setItems(r.items)).catch(e=>toast.error(errorMessage(e)));
  useEffect(()=>{void load();},[projectId]); // eslint-disable-line react-hooks/exhaustive-deps
  const run=async(kind:string)=>{setBusy(kind);try{await invoke({url,method:'POST',data:{kind,prompt},timeoutMs:240000});await load();toast.success('报告已保存');}catch(e){toast.error(errorMessage(e));}finally{setBusy('');}};
  return <section className="border-t pt-4"><h3 className="font-semibold">研究与增长</h3><p className="my-2 text-xs text-muted-foreground">联网研究使用 Tavily 检索并附来源；SEO 检查实际页面；推广文案为草稿，不会自动投放广告。</p><Textarea placeholder="研究问题，或推广目标、受众…" value={prompt} onChange={e=>setPrompt(e.target.value)}/><div className="my-3 flex flex-wrap gap-2">{[['research','联网研究'],['seo','SEO 检查'],['marketing','推广文案']].map(([k,label])=><Button key={k} variant="outline" size="sm" disabled={!!busy} onClick={()=>void run(k)}>{busy===k?'处理中…':label}</Button>)}</div>
    {items.map(r=><details key={r.id} className="mb-2 rounded border p-3"><summary className="cursor-pointer text-sm">{r.title} · v{r.version}</summary><p className="my-3 whitespace-pre-wrap text-sm">{r.body}</p>{r.sources?.map(s=><a key={s.id} className="my-1 block text-xs text-primary underline" href={s.url} target="_blank" rel="noreferrer">[{s.id}] {s.title}</a>)}<Button size="sm" variant="ghost" onClick={()=>downloadBlob(new Blob([r.title+'\n\n'+r.body+'\n\n'+(r.sources||[]).map(s=>`[${s.id}] ${s.title}: ${s.url}`).join('\n')],{type:'text/plain;charset=utf-8'}),'atomforge-report.txt')}>下载报告</Button></details>)}
  </section>;
}
