import {useEffect,useRef,useState} from 'react';
import {invoke} from '@/lib/sdk';
import {recoveringQuery,type QueryState} from '@/lib/recoveringQuery';

export function useRecoveringQuery<T>(url:string){
  const [state,setState]=useState<QueryState<T>>({refreshing:true,waiting:false});
  const query=useRef<ReturnType<typeof recoveringQuery<T>>>();
  useEffect(()=>{
    const current=recoveringQuery(()=>invoke<T>({url,timeoutMs:8000}),setState);
    query.current=current;void current.refresh();
    const refresh=()=>{if(document.visibilityState==='visible')void current.refresh();};
    window.addEventListener('online',refresh);window.addEventListener('focus',refresh);document.addEventListener('visibilitychange',refresh);
    return()=>{current.stop();window.removeEventListener('online',refresh);window.removeEventListener('focus',refresh);document.removeEventListener('visibilitychange',refresh);};
  },[url]);
  return {...state,refresh:()=>query.current?.refresh()};
}
