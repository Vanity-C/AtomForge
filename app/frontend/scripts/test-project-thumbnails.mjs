import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import test from 'node:test';
import ts from 'typescript';

const source=await readFile(new URL('../src/lib/projectThumbnailLoader.ts',import.meta.url),'utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;
const {createProjectThumbnailLoader}=await import('data:text/javascript;base64,'+Buffer.from(compiled).toString('base64'));
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const ready=(version=1)=>({status:'ready',version,src:'data:image/jpeg;base64,test'});
function fixture(options={}){
  let session='alice',now=100;
  const requests=[];
  const loader=createProjectThumbnailLoader({session:()=>session,now:()=>now,fetch:(id,cachedOnly)=>new Promise((resolve,reject)=>requests.push({id,cachedOnly,resolve,reject})),...options});
  return {loader,requests,switchSession:next=>{session=next;loader.syncSession();},advance:ms=>{now+=ms;}};
}

test('six cached reads start in parallel, with a bounded request limit',async()=>{
  const f=fixture();const loads=Array.from({length:8},(_,i)=>f.loader.load(i,1));
  await tick();assert.equal(f.requests.length,6);
  f.requests.forEach(r=>r.resolve(ready()));await tick();
  assert.equal(f.requests.length,8);
  f.requests.slice(6).forEach(r=>r.resolve(ready()));await Promise.all(loads);
});

test('slow first captures cannot block ready covers; expensive work stays serial',async()=>{
  const f=fixture();const a=f.loader.load(1,1),b=f.loader.load(2,1);
  await tick();f.requests.forEach(r=>r.resolve({status:'pending',version:1}));await tick();
  assert.equal(f.requests.filter(r=>!r.cachedOnly).length,1);
  const c=f.loader.load(3,1);await tick();
  f.requests.find(r=>r.id===3).resolve(ready());await c;
  assert.equal(f.loader.peek(3,1).status,'ready');
  f.requests.find(r=>!r.cachedOnly).resolve(ready());await a;await tick();
  const renders=f.requests.filter(r=>!r.cachedOnly);assert.equal(renders.length,2);
  renders[1].resolve(ready());await b;
});

test('duplicate cards share work and route remounts use memory without a request',async()=>{
  const f=fixture();const a=f.loader.load(1,1),b=f.loader.load(1,1);
  assert.equal(a,b);await tick();assert.equal(f.requests.length,1);
  f.requests[0].resolve(ready());await a;
  assert.deepEqual(f.loader.peek(1,1),ready());await f.loader.load(1,1);
  assert.equal(f.requests.length,1);
  const v2=f.loader.load(1,2);await tick();f.requests[1].resolve(ready(2));await v2;
  assert.equal(f.loader.peek(1,1),null);assert.equal(f.loader.peek(1,2).version,2);
});

test('logout clears covers and delayed responses cannot populate another account',async()=>{
  const f=fixture();const a=f.loader.load(1,1);await tick();f.requests[0].resolve(ready());await a;
  const pending=f.loader.load(2,1);const rejected=assert.rejects(pending,/取消/);await tick();
  f.switchSession('bob');assert.equal(f.loader.peek(1,1),null);
  f.requests[1].resolve(ready());await rejected;assert.equal(f.loader.peek(2,1),null);
  f.switchSession('alice');assert.equal(f.loader.peek(1,1),null);
});

test('unmounted queued cards skip work but a second interested card retains it',async()=>{
  const f=fixture();const blockers=Array.from({length:6},(_,i)=>f.loader.load(i,1));
  let mounted=true;
  const skipped=f.loader.load(7,1,()=>mounted),retained=f.loader.load(8,1,()=>mounted);
  const rejected=assert.rejects(skipped,/取消/);
  assert.equal(retained,f.loader.load(8,1,()=>true));mounted=false;
  await tick();f.requests.forEach(r=>r.resolve(ready()));await Promise.all(blockers);await tick();
  await rejected;assert.equal(f.requests.some(r=>r.id===7),false);
  f.requests.find(r=>r.id===8).resolve(ready());await retained;
});

test('failed reads and changed versions are not cached and can retry',async()=>{
  const f=fixture();const a=f.loader.load(1,1);const rejected=assert.rejects(a,/offline/);await tick();f.requests[0].reject(Error('offline'));await rejected;
  const b=f.loader.load(1,1);await tick();f.requests[1].resolve(ready(2));await b;
  assert.equal(f.loader.peek(1,1),null);
  const c=f.loader.load(1,1);await tick();f.requests[2].resolve(ready());await c;
  assert.equal(f.loader.peek(1,1).status,'ready');
});

test('a completed read is reusable even if its original card unmounted',async()=>{
  const f=fixture();let mounted=true;
  const read=f.loader.load(1,1,()=>mounted);await tick();mounted=false;
  f.requests[0].resolve(ready());await read;
  assert.deepEqual(f.loader.peek(1,1),ready());
});

test('cover cache expires and obeys both memory and entry limits',async()=>{
  for(const options of [{maxEntries:1},{maxBytes:ready().src.length*2+1}]){
    const f=fixture(options);
    for(const id of [1,2]){const p=f.loader.load(id,1);await tick();f.requests.at(-1).resolve(ready());await p;}
    assert.equal(f.loader.peek(1,1),null);assert.ok(f.loader.peek(2,1));
    f.advance(300000);assert.equal(f.loader.peek(2,1),null);
  }
});
