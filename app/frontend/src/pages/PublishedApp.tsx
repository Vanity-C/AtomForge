import {useEffect,useState} from 'react';
import {useParams} from 'react-router-dom';
import PreviewFrame from '@/components/PreviewFrame';
import {invoke,errorMessage} from '@/lib/sdk';
import type {Artifact} from '@/lib/studio';
export default function PublishedApp(){
  const {slug}=useParams();
  const [data,setData]=useState<{name:string;artifact:Artifact;cloud_slug:string|null}>();
  const [error,setError]=useState('');
  useEffect(()=>{void invoke<typeof data>({url:'/api/v1/studio/published/'+encodeURIComponent(slug||''),auth:false}).then(setData).catch(e=>setError(errorMessage(e)));},[slug]);
  if(error)return <main className="p-8 text-center">{error}</main>;
  if(!data)return <main className="p-8 text-center">正在加载应用…</main>;
  return <div className="h-screen"><PreviewFrame files={[]} artifact={data.artifact} cloudSlug={data.cloud_slug} storageKey={'published-'+slug}/></div>;
}
