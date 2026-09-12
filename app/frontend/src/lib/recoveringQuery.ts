export type QueryState<T>={data?:T;refreshing:boolean;waiting:boolean;updatedAt?:number};
type Clock={set:(fn:()=>void,delay:number)=>unknown;clear:(id:unknown)=>void};
/** Retry transient read failures without exposing transport errors or discarding real data. */
export function recoveringQuery<T>(load:()=>Promise<T>,onChange:(state:QueryState<T>)=>void,clock:Clock={set:(fn,delay)=>setTimeout(fn,delay),clear:id=>clearTimeout(id as ReturnType<typeof setTimeout>)}) {
  let state:QueryState<T>={refreshing:false,waiting:false};
  let stopped=false;let running=false;let timer:unknown;let failures=0;
  const refresh=async()=>{
    if(stopped||running)return;
    if(timer!==undefined)clock.clear(timer);
    running=true;state={...state,refreshing:true};onChange(state);
    try{
      const data=await load();
      if(stopped)return;
      failures=0;state={data,refreshing:false,waiting:false,updatedAt:Date.now()};
    }catch{
      if(stopped)return;
      failures++;state={...state,refreshing:false,waiting:true};
    }finally{
      running=false;
      if(!stopped){onChange(state);timer=clock.set(()=>void refresh(),failures?[2000,5000,15000,60000][Math.min(failures-1,3)]:60000);}
    }
  };
  return {refresh,stop:()=>{stopped=true;if(timer!==undefined)clock.clear(timer);}};
}
