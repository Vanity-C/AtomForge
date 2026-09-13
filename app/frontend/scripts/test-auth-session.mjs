import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import test from 'node:test';
import ts from 'typescript';

const source=await readFile(new URL('../src/lib/sdk.ts',import.meta.url),'utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;
const TOKEN='atomforge.session.token', USER='atomforge.session.user';
const alice={id:'alice',email:'alice@example.test',display_name:'Alice'};
const bob={id:'bob',email:'bob@example.test',display_name:'Bob'};
let sequence=0;
const response=(payload,status=200)=>new Response(JSON.stringify(payload),{status,headers:{'Content-Type':'application/json'}});
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
async function fixture(t,fetch){
  const previous=Object.getOwnPropertyDescriptor(globalThis,'localStorage');
  const storage=new Map([[TOKEN,'token-alice'],[USER,JSON.stringify(alice)]]);
  Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,String(value)),removeItem:key=>storage.delete(key)}});
  t.after(()=>{if(previous)Object.defineProperty(globalThis,'localStorage',previous);else delete globalThis.localStorage;});
  t.mock.method(globalThis,'fetch',fetch);
  const sdk=await import('data:text/javascript;base64,'+Buffer.from(compiled).toString('base64')+'#'+(++sequence));
  const events=[];sdk.onAuthChange(user=>events.push(user));
  return {sdk,storage,events};
}

test('simultaneous identity checks share one request and later checks can refresh',async t=>{
  const pending=deferred();let calls=0;
  const {sdk,events}=await fixture(t,async()=>++calls===1?pending.promise:response({user:alice}));
  const first=sdk.fetchCurrentUser(),second=sdk.fetchCurrentUser();
  assert.equal(first,second);
  assert.equal(calls,1);
  pending.resolve(response({user:alice}));
  assert.deepEqual(await first,alice);
  assert.equal(events.length,1);
  await sdk.fetchCurrentUser();
  assert.equal(calls,2);
});

test('a late successful identity check cannot overwrite a new login or clear its pending request',async t=>{
  const old=deferred(),fresh=deferred();let meCalls=0;
  const {sdk,storage,events}=await fixture(t,async(url,options)=>{
    if(url.endsWith('/login'))return response({access_token:'token-bob',user:bob});
    meCalls++;return options.headers['X-AtomForge-Token']==='token-alice'?old.promise:fresh.promise;
  });
  const oldLookup=sdk.fetchCurrentUser();
  await sdk.signIn('bob','test-only-password');
  const newLookup=sdk.fetchCurrentUser();
  old.resolve(response({user:{...alice,display_name:'Stale Alice'}}));
  assert.deepEqual(await oldLookup,bob);
  assert.deepEqual(sdk.cachedUser(),bob);
  assert.deepEqual(JSON.parse(storage.get(USER)),bob);
  assert.equal(storage.get(TOKEN),'token-bob');
  assert.equal(sdk.fetchCurrentUser(),newLookup);
  assert.equal(meCalls,2);
  assert.deepEqual(events,[bob]);
  fresh.resolve(response({user:{...bob,display_name:'Fresh Bob'}}));
  assert.equal((await newLookup).display_name,'Fresh Bob');
});

for(const status of [401,503])test(`a late ${status} from the old login returns the current identity`,async t=>{
  const pending=deferred();
  const {sdk,storage,events}=await fixture(t,async url=>url.endsWith('/login')?response({access_token:'token-bob',user:bob}):pending.promise);
  const oldLookup=sdk.fetchCurrentUser();
  await sdk.signIn('bob','test-only-password');
  pending.resolve(response({detail:'Old request failed'},status));
  assert.deepEqual(await oldLookup,bob);
  assert.deepEqual(sdk.cachedUser(),bob);
  assert.equal(storage.get(TOKEN),'token-bob');
  assert.deepEqual(events,[bob]);
});

test('a successful response arriving after sign-out cannot resurrect the signed-out profile',async t=>{
  const pending=deferred();
  const {sdk,storage,events}=await fixture(t,async url=>url.endsWith('/logout')?response({success:true}):pending.promise);
  const oldLookup=sdk.fetchCurrentUser();
  await sdk.signOut();
  pending.resolve(response({user:alice}));
  assert.equal(await oldLookup,null);
  assert.equal(sdk.cachedUser(),null);
  assert.equal(storage.has(TOKEN),false);
  assert.equal(storage.has(USER),false);
  assert.deepEqual(events,[null]);
});

test('a transient failure within the same session preserves the existing identity',async t=>{
  const {sdk,storage,events}=await fixture(t,async()=>{throw new TypeError('Connection unavailable');});
  assert.deepEqual(await sdk.fetchCurrentUser(),alice);
  assert.equal(storage.get(TOKEN),'token-alice');
  assert.deepEqual(events,[]);
});

test('an unauthorized current session is still signed out',async t=>{
  const {sdk,storage,events}=await fixture(t,async()=>response({detail:'Session expired'},401));
  assert.equal(await sdk.fetchCurrentUser(),null);
  assert.equal(sdk.cachedUser(),null);
  assert.equal(storage.has(TOKEN),false);
  assert.deepEqual(events,[null]);
});
