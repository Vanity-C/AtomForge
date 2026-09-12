import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import test from 'node:test';
import ts from 'typescript';
const source=await readFile(new URL('../src/lib/recoveringQuery.ts',import.meta.url),'utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;
const {recoveringQuery}=await import('data:text/javascript;base64,'+Buffer.from(compiled).toString('base64'));
const clock=()=>({jobs:new Map(),next:0,set(fn,delay){const id=++this.next;this.jobs.set(id,{fn,delay});return id;},clear(id){this.jobs.delete(id);}});
test('temporary fetch failure automatically recovers without fabricated usage or raw errors',async()=>{
  const time=clock();const states=[];let calls=0;
  const query=recoveringQuery(async()=>{if(++calls===1)throw Error('Failed to fetch');return {input_tokens:123};},s=>states.push(s),time);
  await query.refresh();
  assert.equal(states.at(-1).data,undefined);assert.equal(states.at(-1).waiting,true);
  assert.equal(JSON.stringify(states).includes('Failed to fetch'),false);
  const retry=[...time.jobs.values()][0];assert.equal(retry.delay,2000);retry.fn();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(states.at(-1).data.input_tokens,123);assert.equal(states.at(-1).waiting,false);
  query.stop();assert.equal(time.jobs.size,0);
});
test('failed refresh retains last genuine counters and later refresh updates them',async()=>{
  const time=clock();let state;let calls=0;
  const query=recoveringQuery(async()=>{calls++;if(calls===2)throw Error('connection reset');return {tokens:calls*20};},s=>{state=s;},time);
  await query.refresh();await query.refresh();assert.equal(state.data.tokens,20);assert.equal(state.waiting,true);
  await query.refresh();assert.equal(state.data.tokens,60);assert.equal(state.waiting,false);query.stop();
});
test('overlapping refreshes are deduplicated and disposed requests do not update an unmounted page',async()=>{
  const time=clock();let resolve;let calls=0;const states=[];
  const query=recoveringQuery(()=>{calls++;return new Promise(r=>{resolve=r;});},s=>states.push(s),time);
  const pending=query.refresh();await query.refresh();assert.equal(calls,1);query.stop();resolve({tokens:2});await pending;
  assert.equal(states.length,1);assert.equal(time.jobs.size,0);
});
test('persistent outage uses bounded retry frequency and reset after success',async()=>{
  const time=clock();let fail=true;
  const query=recoveringQuery(async()=>{if(fail)throw Error('offline');return {};},()=>{},time);
  for(const delay of [2000,5000,15000,60000,60000]){await query.refresh();assert.equal([...time.jobs.values()][0].delay,delay);assert.equal(time.jobs.size,1);}
  fail=false;await query.refresh();fail=true;await query.refresh();assert.equal([...time.jobs.values()][0].delay,2000);query.stop();
});
