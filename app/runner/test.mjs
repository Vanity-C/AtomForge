import {test} from 'node:test';
import assert from 'node:assert/strict';
import {compile,check,visualEdit,MAX_TEST_STEPS,ready} from './server.mjs';
test('readiness proves compilation and a working browser, including simultaneous probes',async()=>{
  const results=await Promise.all([ready(),ready()]);
  assert.deepEqual(results,[{status:'ready'},{status:'ready'}]);
});
test('long interaction suites preserve state and execute assertions beyond step twelve',async()=>{
  const artifact=await compile([{path:'App.jsx',content:`export default function App(){const [n,setN]=React.useState(0);return <button onClick={()=>setN(n+1)}>{n}</button>}`}]);
  const steps=Array.from({length:13},()=>({action:'click',selector:'button'}));
  const passed=await check(artifact,[...steps,{action:'text',selector:'button',value:'13'}]);
  assert.equal(passed.ok,true,JSON.stringify(passed));
  assert.equal(passed.logs.filter(line=>line.startsWith('PASS click')).length,13);
  const failed=await check(artifact,[...steps,{action:'text',selector:'button',value:'wrong'}]);
  assert.equal(failed.ok,false);
  assert.match(failed.error,/第 14 步/);
});
test('test protocol rejects oversized or malformed suites without silently dropping steps',async()=>{
  await assert.rejects(()=>check({},Array.from({length:MAX_TEST_STEPS+1},()=>({action:'visible',selector:'button'}))),/测试协议错误.*49.*48/);
  for(const steps of [{},[null],[{action:'execute',selector:'button'}],[{action:'fill',selector:'input'}],[{action:'visible',selector:''}]]) {
    await assert.rejects(()=>check({},steps),/测试协议错误/);
  }
});
test('compile and exercise a React TypeScript application',async()=>{
  const a=await compile([{path:'App.tsx',content:`import {useState} from 'react'; export default function App(){const [n,setN]=useState<number>(0);return <button data-testid="count" onClick={()=>setN(n+1)}>{n}</button>}`}]);
  const r=await check(a,[{action:'click',selector:'[data-testid=count]'},{action:'text',selector:'[data-testid=count]',value:'1'}]);
  assert.equal(r.ok,true,JSON.stringify(r));
});
test('reject paths, imports and missing entry',async()=>{
  await assert.rejects(()=>compile([{path:'../App.jsx',content:''}]));
  await assert.rejects(()=>compile([{path:'App.jsx',content:`import '/etc/passwd';export default function App(){return null}`}]),/暂不支持/);
  await assert.rejects(()=>compile([{path:'App.jsx',content:`import x from 'node:fs'; export default function App(){return x}`}]),/暂不支持/);
});
test('detect runtime errors and failing interaction assertions',async()=>{
  const a=await compile([{path:'App.jsx',content:'export default function App(){throw new Error("broken")}'}]);
  assert.equal((await check(a)).ok,false);
  const b=await compile([{path:'App.jsx',content:'export default function App(){return <h1>hello</h1>}'}]);
  const failed=await check(b,[{action:'text',selector:'h1',value:'wrong'}]);
  assert.equal(failed.ok,false);
  assert.match(failed.error,/第 1 步 text h1/);
  assert.match(failed.error,/wrong/);
  assert.match(failed.error,/hello/);
  assert.ok(failed.logs.some(line=>line.startsWith('FAIL ')));
});
test('visual editing rewrites static JSX while preserving interaction and other files',async()=>{
  const source=`import {useState} from 'react';export default function App(){const [n,setN]=useState(0);return <main><h1>Old title</h1><button onClick={()=>setN(n+1)}>{n}</button></main>}`;
  const files=[{path:'App.jsx',content:source},{path:'keep.css',content:'body{margin:0}'}];
  const changed=visualEdit(files,{source:'App.jsx:'+source.indexOf('<h1>'),text:'New title',style:{color:'#7711aa'}});
  assert.equal(changed[1].content,files[1].content);
  const r=await check(await compile(changed),[{action:'text',selector:'h1',value:'New title'},{action:'click',selector:'button'},{action:'text',selector:'button',value:'1'}]);
  assert.equal(r.ok,true,JSON.stringify(r));
  assert.throws(()=>visualEdit(files,{source:'App.jsx:'+source.indexOf('<button'),text:'bad'}),/动态/);
  assert.throws(()=>visualEdit(files,{source:'App.jsx:9999',text:'bad'}),/位置/);
});
test('cloud SDK is available during module initialization and auth updates the UI',async()=>{
  const source=`const auth=typeof AtomForge!=='undefined'&&AtomForge.auth;export default function App(){const [name,setName]=React.useState(auth?'ready':'missing');return <button onClick={async()=>{const {user}=await auth.register('test@example.test','test');setName(user.email)}}>{name}</button>}`;
  const result=await check(await compile([{path:'App.jsx',content:source}]),[{action:'text',selector:'button',value:'ready'},{action:'click',selector:'button'},{action:'text',selector:'button',value:'test@example.test'}]);
  assert.equal(result.ok,true,JSON.stringify(result));
});
