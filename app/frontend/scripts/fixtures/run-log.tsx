import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import RunLog from '../../src/components/RunLog';
import type {StudioRun} from '../../src/lib/studio';
import '../../src/index.css';

function Fixture(){
  const [total,setTotal]=useState(350);
  const run:StudioRun={id:'log-fixture',project_id:1,status:'running',stage:'test',error:'',result:{},events_total:total,
    events:[{id:total,stage:'test',message:'最新日志',at:'2026-09-16T00:00:00Z'}]};
  return <main className="mx-auto max-w-3xl space-y-4 p-4"><h1>执行日志回归</h1><button onClick={()=>setTotal(value=>value+1)}>新增日志</button><RunLog run={run}/></main>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);
