import {createZip,downloadBlob,safeFileStem} from '@/lib/zip';
import {invoke} from '@/lib/sdk';
export async function exportProject(name:string,source:{projectId:number}|{slug:string}){
  const url='projectId' in source?`/api/v1/studio/projects/${source.projectId}/export`:`/api/v1/studio/shared/${encodeURIComponent(source.slug)}/export`;
  const {entries}=await invoke<{entries:{path:string;content:string}[]}>({url,auth:'projectId' in source});
  const stem=safeFileStem(name);
  downloadBlob(createZip(entries.map(f=>({path:`${stem}/${f.path}`,content:f.content}))),`${stem}.zip`);
}
