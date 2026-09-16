import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {compile,check,visualEdit,MAX_TEST_STEPS,ready} from './server.mjs';
test('project cover is the actual initial render before interaction tests mutate it',async()=>{
  const artifact=await compile([{path:'App.jsx',content:`export default function App(){const [n,setN]=React.useState(0);return <main style={{background:n?'#ce3030':'#264f35',height:800,color:'#fff'}}><h1>Actual project cover</h1><button onClick={()=>setN(n+1)}>{n}</button></main>}`}]);
  const initial=await check(artifact,[],{capture:true});
  const interacted=await check(artifact,[{action:'click',selector:'button'},{action:'text',selector:'button',value:'1'}],{capture:true});
  assert.equal(initial.ok,true,JSON.stringify(initial));
  assert.equal(interacted.ok,true,JSON.stringify(interacted));
  assert.match(initial.thumbnail,/^data:image\/jpeg;base64,\/9j\//);
  assert.ok(initial.thumbnail.length>1000);
  assert.equal(initial.thumbnail,interacted.thumbnail,'cover must not show state created by a test');
});
test('cover rendering cannot open a WebSocket to the runner network',async()=>{
  let handshakes=0;
  const probe=http.createServer((req,res)=>res.end());
  probe.on('upgrade',(req,socket)=>{handshakes++;socket.destroy();});
  await new Promise(resolve=>probe.listen(0,'127.0.0.1',resolve));
  try {
    const address='ws://127.0.0.1:'+probe.address().port;
    const artifact=await compile([{path:'App.jsx',content:`const socket=new WebSocket(${JSON.stringify(address)});export default function App(){return <h1>Offline cover</h1>}`}]);
    const result=await check(artifact,[],{capture:true});
    assert.equal(result.ok,true,JSON.stringify(result));
    assert.equal(handshakes,0,'untrusted application must not reach local services via WebSocket');
  } finally {await new Promise(resolve=>probe.close(resolve));}
});
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
  await assert.rejects(()=>check({},Array.from({length:MAX_TEST_STEPS+1},()=>({action:'visible',selector:'button'}))),new RegExp(`测试协议错误.*${MAX_TEST_STEPS+1}.*${MAX_TEST_STEPS}`));
  for(const steps of [{},[null],[{action:'execute',selector:'button'}],[{action:'fill',selector:'input'}],[{action:'visible',selector:''}]]) {
    await assert.rejects(()=>check({},steps),/测试协议错误/);
  }
});

test('SVG definition existence is distinct from rendered visibility',async()=>{
  const artifact=await compile([{path:'App.jsx',content:`export default function App(){return <svg width="200" height="200"><g id="wheel"><circle cx="80" cy="80" r="30"/><animateTransform id="spin" attributeName="transform" type="rotate" from="0 80 80" to="360 80 80" dur="1s" repeatCount="indefinite"/></g></svg>}`}]);
  for(const action of ['visible','hidden']) {
    const result=await check(artifact,[{action,selector:'#spin'}]);
    assert.equal(result.ok,false);
    assert.equal(result.failure.kind,'protocol');
    assert.match(result.error,/测试协议错误.*attached\/detached/);
  }
  const valid=await check(artifact,[{action:'visible',selector:'#wheel'},{action:'attached',selector:'#spin[dur="1s"]'},{action:'detached',selector:'#missing-animation'}]);
  assert.equal(valid.ok,true,JSON.stringify(valid));
  for(const step of [{action:'attached',selector:'#missing-animation'},{action:'detached',selector:'#spin'},{action:'attached',selector:'#spin[dur="99s"]'}]) {
    const result=await check(artifact,[step]);
    assert.equal(result.ok,false,'missing nodes and wrong attributes must fail');
    assert.equal(result.failure.kind,'assertion');
  }
});

test('disabled input validation is asserted, persistence survives real reload, and storage stays isolated',async()=>{
  const artifact=await compile([{path:'App.jsx',content:`export default function App(){const [name,setName]=React.useState('');const [saved,setSaved]=React.useState(()=>localStorage.getItem('habit')||'empty');return <main><input value={name} onChange={e=>setName(e.target.value)}/><button disabled={!name.trim()} onClick={()=>{localStorage.setItem('habit',name);setSaved(name)}}>Add</button><p>{saved}</p></main>}`}]);
  const result=await check(artifact,[
    {action:'disabled',selector:'button'},
    {action:'fill',selector:'input',value:'   '},
    {action:'disabled',selector:'button'},
    {action:'fill',selector:'input',value:'Water'},
    {action:'enabled',selector:'button'},
    {action:'click',selector:'button'},
    {action:'reload'},
    {action:'text',selector:'p',value:'Water'},
    {action:'disabled',selector:'button'},
    {action:'clear_storage'},
    {action:'reload'},
    {action:'text',selector:'p',value:'empty'},
    {action:'hidden',selector:'[data-does-not-exist]'},
  ]);
  assert.equal(result.ok,true,JSON.stringify(result));
  const blocked=await check(artifact,[{action:'click',selector:'button'}]);
  assert.equal(blocked.ok,false);
  assert.deepEqual(blocked.failure,{kind:'interaction',step:1,action:'click',selector:'button',actual:'Add',disabled:true});
  assert.match(blocked.error,/disabled/);
  const fresh=await check(artifact,[{action:'text',selector:'p',value:'empty'}]);
  assert.equal(fresh.ok,true,JSON.stringify(fresh));
  const badState=await check(artifact,[{action:'enabled',selector:'button'}]);
  assert.equal(badState.ok,false,'state assertions must fail, not silently pass');
});

test('reload detects applications that forgot persistence',async()=>{
  const artifact=await compile([{path:'App.jsx',content:`export default function App(){const [n,setN]=React.useState(0);return <button onClick={()=>setN(n+1)}>{n}</button>}`}]);
  const result=await check(artifact,[{action:'click',selector:'button'},{action:'reload'},{action:'text',selector:'button',value:'1'}]);
  assert.equal(result.ok,false);
  assert.equal(result.failure.kind,'assertion');
  assert.equal(result.failure.actual,'0');
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
