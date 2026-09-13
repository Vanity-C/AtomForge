import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import test from 'node:test';
import ts from 'typescript';

const moduleUrl=source=>'data:text/javascript;base64,'+Buffer.from(source).toString('base64');
const sdk=moduleUrl(`export const readToken=()=>'';export const cachedUser=()=>null;export const onAuthChange=()=>()=>{};export const errorMessage=(error,fallback='请求失败')=>error?.message||fallback;export const invoke=async()=>{throw Error('Unexpected real API request in collection test');};`);
const source=await readFile(new URL('../src/lib/projectCollection.ts',import.meta.url),'utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText
  .replace(/(['"])(?:\.\/|@\/lib\/)sdk\1/g,JSON.stringify(sdk));
const {createProjectCollection}=await import(moduleUrl(compiled));

const project=(id,extra={})=>({id,name:`作品 ${id}`,description:'',initial_prompt:'测试需求',agent_mode:'team',template:'',status:'ready',current_version:1,entry_file:'src/App.tsx',share_slug:'',is_public:false,view_count:0,role:'owner',...extra});
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
function fixture(options={}){
  let session='account-a',time=1000;
  const requests=[];
  const store=createProjectCollection({session:()=>session,now:()=>time,fetchProjects:()=>{const request=deferred();requests.push(request);return request.promise;},...options});
  return {store,requests,setSession:value=>{session=value;store.syncSession();},advance:duration=>{time+=duration;}};
}
async function loaded(fixture,projects,force=false){const pending=fixture.store.load(force);await Promise.resolve();fixture.requests.at(-1).resolve(projects);await pending;}
const byId=store=>Object.fromEntries(store.getSnapshot().projects.map(item=>[item.id,item]));

test('stable snapshots survive subscriber remounts and concurrent loads share one request',async()=>{
  const f=fixture();
  const initial=f.store.getSnapshot();
  assert.equal(f.store.getSnapshot(),initial);
  const notices=[];
  const unsubscribe=f.store.subscribe(()=>notices.push(f.store.getSnapshot()));
  const first=f.store.load(),second=f.store.load(),third=f.store.load(true);
  await Promise.resolve();
  assert.equal(f.requests.length,1);
  assert.equal(f.store.getSnapshot().refreshing,true);
  f.requests[0].resolve([project(1)]);
  await Promise.all([first,second,third]);
  const completed=f.store.getSnapshot();
  assert.equal(completed.loaded,true);
  assert.equal(completed.refreshing,false);
  assert.deepEqual(completed.projects.map(item=>item.id),[1]);
  assert.deepEqual(initial.projects,[],'a later response must not mutate a prior snapshot');
  assert.equal(f.store.getSnapshot(),completed);
  assert.ok(notices.length>0);
  unsubscribe();
  const count=notices.length;
  const remount=f.store.subscribe(()=>{});
  await f.store.load();
  assert.equal(f.requests.length,1,'changing pages must reuse the warm shared collection');
  assert.equal(f.store.getSnapshot(),completed);
  f.store.upsert(project(2),'account-a');
  assert.equal(notices.length,count,'removed subscribers must stay unsubscribed');
  assert.deepEqual(completed.projects.map(item=>item.id),[1]);
  remount();
});

test('default five-minute TTL and a custom TTL refresh only after the cached data expires',async()=>{
  for(const maxAgeMs of [undefined,200]){
    const f=fixture(maxAgeMs===undefined?{}:{maxAgeMs});
    await loaded(f,[project(1)]);
    const ttl=maxAgeMs??300000;
    f.advance(ttl-1);
    await f.store.load();
    assert.equal(f.requests.length,1);
    f.advance(2);
    const expired=f.store.load();
    await Promise.resolve();
    assert.equal(f.requests.length,2);
    assert.deepEqual(f.store.getSnapshot().projects.map(item=>item.id),[1]);
    f.requests[1].resolve([project(2)]);
    await expired;
    assert.deepEqual(f.store.getSnapshot().projects.map(item=>item.id),[2]);
  }
});

test('failed refresh retains real data, remounts reuse the error, and an explicit retry recovers',async()=>{
  const f=fixture();
  await loaded(f,[project(1)]);
  const pending=f.store.load(true);
  await Promise.resolve();
  assert.equal(f.requests.length,2);
  assert.equal(f.store.getSnapshot().loaded,true);
  assert.equal(f.store.getSnapshot().refreshing,true);
  assert.deepEqual(f.store.getSnapshot().projects.map(item=>item.id),[1]);
  f.requests[1].reject(Error('temporary outage'));
  await assert.doesNotReject(pending);
  assert.ok(f.store.getSnapshot().error);
  assert.equal(f.store.getSnapshot().refreshing,false);
  assert.deepEqual(f.store.getSnapshot().projects.map(item=>item.id),[1]);
  await f.store.load();
  assert.equal(f.requests.length,2,'route remounts must not repeatedly send a known failing request');
  const retry=f.store.load(true);
  await Promise.resolve();
  assert.equal(f.requests.length,3,'an error must not leave the failed request or fresh TTL blocking retry');
  f.requests[2].resolve([project(1,{name:'已恢复'})]);
  await retry;
  assert.equal(f.store.getSnapshot().error,'');
  assert.equal(byId(f.store)[1].name,'已恢复');
});

test('initial failure remains unloaded and permits an explicit retry',async()=>{
  const f=fixture();
  const pending=f.store.load();
  await Promise.resolve();
  f.requests[0].reject(Error('offline'));
  await assert.doesNotReject(pending);
  assert.equal(f.store.getSnapshot().loaded,false);
  assert.equal(f.store.getSnapshot().refreshing,false);
  assert.deepEqual(f.store.getSnapshot().projects,[]);
  await loaded(f,[project(1)],true);
  assert.equal(f.requests.length,2);
  assert.equal(f.store.getSnapshot().loaded,true);
});

test('rename, creation and deletion win over an older in-flight list without losing membership role',async()=>{
  const f=fixture();
  const old=project(1,{role:'editor'});
  await loaded(f,[old,project(2)]);
  const original=f.store.getSnapshot();
  const pending=f.store.load(true);
  await Promise.resolve();
  const renamed=project(1,{name:'我刚改过的名字',current_version:2});
  delete renamed.role; // PATCH responses can omit list-only membership metadata.
  f.store.upsert(renamed,'account-a');
  f.store.remove(2,'account-a');
  f.store.upsert(project(4,{name:'刚创建的项目'}),'account-a');
  f.requests[1].resolve([old,project(2),project(3)]);
  await pending;
  const final=byId(f.store);
  assert.deepEqual(Object.keys(final).sort(),['1','3','4']);
  assert.equal(final[1].name,'我刚改过的名字');
  assert.equal(final[1].current_version,2);
  assert.equal(final[1].role,'editor');
  assert.equal(final[4].name,'刚创建的项目');
  assert.deepEqual(Object.fromEntries(original.projects.map(item=>[item.id,item.name])),{1:'作品 1',2:'作品 2'});
});

test('invalidation during a request remains stale until a later request completes',async()=>{
  for(const fails of [false,true]){
    const f=fixture();
    await loaded(f,[project(1)]);
    const pending=f.store.load(true);
    await Promise.resolve();
    f.store.invalidate('account-a');
    assert.equal(f.store.getSnapshot().stale,true);
    if(fails)f.requests[1].reject(Error('outage during a project update'));else f.requests[1].resolve([project(1)]);
    await pending;
    assert.equal(f.store.getSnapshot().stale,true,'neither success nor failure may clear a newer invalidation');
    const followup=f.store.load();
    await Promise.resolve();
    assert.equal(f.requests.length,3);
    f.requests[2].resolve([project(1,{current_version:2})]);
    await followup;
    assert.equal(f.store.getSnapshot().stale,false);
    assert.equal(byId(f.store)[1].current_version,2);
  }
});

test('account switches ignore both success and failure from the previous account while the new load runs',async()=>{
  for(const fails of [false,true]){
    const f=fixture();
    const previous=f.store.load();
    await Promise.resolve();
    f.setSession('account-b');
    assert.equal(f.store.getSnapshot().loaded,false);
    assert.deepEqual(f.store.getSnapshot().projects,[]);
    const current=f.store.load();
    await Promise.resolve();
    assert.equal(f.requests.length,2);
    if(fails)f.requests[0].reject(Error('account A expired'));else f.requests[0].resolve([project(91)]);
    await assert.doesNotReject(previous);
    assert.equal(f.store.getSnapshot().refreshing,true,'old finally must not stop the new account loading indicator');
    assert.equal(f.store.getSnapshot().error,'');
    assert.deepEqual(f.store.getSnapshot().projects,[]);
    f.requests[1].resolve([project(22)]);
    await current;
    assert.deepEqual(f.store.getSnapshot().projects.map(item=>item.id),[22]);
    const unchanged=f.store.getSnapshot();
    f.store.upsert(project(91),'account-a');
    f.store.remove(22,'account-a');
    f.store.invalidate('account-a');
    assert.equal(f.store.getSnapshot(),unchanged,'old-account mutation callbacks must have no effect');
  }
});

test('logout clears cached data and mutations, ignores pending responses, and never fetches anonymously',async()=>{
  const f=fixture();
  await loaded(f,[project(1)]);
  const previous=f.store.load(true);
  await Promise.resolve();
  f.setSession('');
  const anonymous=f.store.getSnapshot();
  assert.equal(anonymous.loaded,false);
  assert.deepEqual(anonymous.projects,[]);
  f.store.upsert(project(99),'account-a');
  f.store.remove(1,'account-a');
  f.store.invalidate('account-a');
  f.requests[1].resolve([project(1)]);
  await previous;
  await f.store.load();
  await f.store.load(true);
  assert.equal(f.requests.length,2);
  assert.equal(f.store.getSnapshot(),anonymous);
  f.setSession('account-a');
  assert.deepEqual(f.store.getSnapshot().projects,[],'logging back in must not resurrect a prior session cache');
  await loaded(f,[project(2)]);
  assert.deepEqual(f.store.getSnapshot().projects.map(item=>item.id),[2]);
});

test('a session change before the deferred fetch starts never sends the old request as the new account',async()=>{
  const f=fixture();
  const previous=f.store.load();
  f.setSession('account-b');
  const current=f.store.load();
  await Promise.resolve();
  assert.equal(f.requests.length,1,'the queued account-A fetch must be skipped before acquiring account-B credentials');
  f.requests[0].resolve([project(22)]);
  await Promise.all([previous,current]);
  assert.deepEqual(f.store.getSnapshot().projects.map(item=>item.id),[22]);
});

test('late single-project reads cannot undo a rename/version update or resurrect a deleted project',async()=>{
  const f=fixture();
  await loaded(f,[project(1),project(2)]);
  const beforeRename=f.store.beginRead(1,'account-a');
  f.store.upsert(project(1,{name:'刚刚重命名',current_version:3}),'account-a');
  const renamed=f.store.getSnapshot();
  f.store.upsert(project(1,{name:'读取到的旧名字',current_version:1}),'account-a',beforeRename);
  f.store.remove(1,'account-a',beforeRename); // A delayed 403/404 is also stale.
  assert.equal(f.store.getSnapshot(),renamed);
  assert.equal(byId(f.store)[1].name,'刚刚重命名');
  assert.equal(byId(f.store)[1].current_version,3);
  const beforeDelete=f.store.beginRead(2,'account-a');
  f.store.remove(2,'account-a');
  const deleted=f.store.getSnapshot();
  f.store.upsert(project(2),'account-a',beforeDelete);
  assert.equal(f.store.getSnapshot(),deleted);
  assert.equal(byId(f.store)[2],undefined);
  f.store.upsert(project(2,{name:'显式的新结果'}),'account-a');
  assert.equal(byId(f.store)[2].name,'显式的新结果','ordinary two-argument mutations must remain applicable');
});

test('newer reads supersede older reads per project, while a current read may update or remove once',async()=>{
  const f=fixture();
  await loaded(f,[project(1),project(2)]);
  const older=f.store.beginRead(1,'account-a');
  const newest=f.store.beginRead(1,'account-a');
  const otherProject=f.store.beginRead(2,'account-a');
  const unchanged=f.store.getSnapshot();
  f.store.upsert(project(1,{name:'较旧请求'}),'account-a',older);
  f.store.remove(1,'account-a',older);
  assert.equal(f.store.getSnapshot(),unchanged);
  f.store.upsert(project(1,{name:'较新请求',current_version:4}),'account-a',newest);
  f.store.upsert(project(2,{name:'另一个项目的请求'}),'account-a',otherProject);
  assert.equal(byId(f.store)[1].name,'较新请求');
  assert.equal(byId(f.store)[2].name,'另一个项目的请求','reading a different project must not invalidate this ticket');
  const accepted=f.store.getSnapshot();
  f.store.remove(1,'account-a',newest);
  assert.equal(f.store.getSnapshot(),accepted,'an accepted read consumes its revision');
  const missing=f.store.beginRead(1,'account-a');
  f.store.remove(1,'account-a',missing); // The current GET confirmed 403/404.
  assert.equal(byId(f.store)[1],undefined);
  const removed=f.store.getSnapshot();
  f.store.upsert(project(1),'account-a',missing);
  assert.equal(f.store.getSnapshot(),removed,'a consumed removal ticket must not resurrect the project');
});
