import {test} from 'node:test';
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {server,ready,compile,check,MAX_TEST_STEPS} from './server.mjs';

test('HTTP executes all 1000 stateful steps beyond old deadlines while remaining ready',{timeout:240000},async()=>{
  assert.equal(MAX_TEST_STEPS,1000);
  await ready();
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${server.address().port}`;
  const controller=new AbortController();
  let pending;
  try {
    const tests=Array.from({length:999},()=>({action:'click',selector:'button'}));
    tests.push({action:'text',selector:'output',value:'count=999;complete'});
    const files=[{path:'App.jsx',content:`export default function App(){const [n,setN]=React.useState(0);const [busy,setBusy]=React.useState(false);return <main><button disabled={busy} onClick={()=>{const next=n+1;setN(next);if(next%10===0){setBusy(true);setTimeout(()=>setBusy(false),900)}}}>Next</button><output>{'count='+n+';complete'}</output></main>}`}];
    const start=Date.now();
    let settled=false, busyProbes=0;
    pending=fetch(base+'/build',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({files,tests}),signal:controller.signal})
      .then(response=>response.json()).finally(()=>{settled=true;});
    pending.catch(()=>{});
    while(!settled){
      await delay(5000);
      if(settled)break;
      const response=await fetch(base+'/ready');
      assert.equal(response.status,200,'an in-budget long plan must remain ready');
      if((await response.json()).busy)busyProbes++;
    }
    const result=await pending;
    assert.equal(result.ok,true,JSON.stringify(result));
    assert.equal(result.logs.filter(line=>line.startsWith('PASS click')).length,999);
    assert.ok(result.logs.includes('PASS text output'),'the last assertion actually ran');
    assert.ok(Date.now()-start>90000,'exercise old 60s/75s/90s cutoffs, not just the new numeric limit');
    assert.ok(busyProbes>10);
    console.log(`1000-step HTTP plan passed in ${Date.now()-start}ms with ${busyProbes} successful busy readiness probes`);
  }finally{
    controller.abort();
    await pending?.catch(()=>{});
    await new Promise(resolve=>server.close(resolve));
  }
});

test('a custom 1500 limit executes beyond the default and a final failure stays a failure',async()=>{
  const artifact=await compile([{path:'App.jsx',content:'export default function App(){return <h1>ready</h1>}'}]);
  const steps=Array.from({length:1000},()=>({action:'attached',selector:'h1'}));
  steps.push({action:'text',selector:'h1',value:'wrong-final-expectation'});
  await assert.rejects(()=>check(artifact,steps),/1001.*1000/);
  const result=await check(artifact,steps,{maxTestSteps:1500});
  assert.equal(result.ok,false);
  assert.equal(result.failure.step,1001);
  assert.equal(result.logs.filter(line=>line.startsWith('PASS attached')).length,1000);
  assert.match(result.error,/wrong-final-expectation/);
});

test('aborted long checks close the browser and preserve unsuccessful status',async()=>{
  const artifact=await compile([{path:'App.jsx',content:'export default function App(){return <h1>ready</h1>}'}]);
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),1500);
  try {
    const result=await check(artifact,Array.from({length:1000},()=>({action:'click',selector:'#missing'})),{signal:controller.signal});
    assert.equal(result.ok,false);
    assert.equal(result.error,'测试请求已取消');
  }finally{clearTimeout(timer);}
});
