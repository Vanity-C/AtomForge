import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import test from 'node:test';
import ts from 'typescript';
const source=await readFile(new URL('../src/lib/pipeline.ts',import.meta.url),'utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;
const {pipelineStages}=await import('data:text/javascript;base64,'+Buffer.from(compiled).toString('base64'));
const docs={product:{goal:'goal'},design:{summary:'design'},architect:{summary:'structure'},engineer:{summary:'code'},qa:{approved:true,verified:false}};
const run=(extra={})=>({id:'run',status:'running',stage:'test',events:[{stage:'test',role:'qa',state:'running',message:'checking'}],result:{team:docs},...extra});
const states=(r,mode)=>Object.fromEntries(pipelineStages(r,mode).map(s=>[s.id,s.state]));
test('empty pipeline promises no completed work',()=>assert.deepEqual(Object.values(states(null)),Array(6).fill('pending')));
test('saved handoffs complete earlier stages but code review alone does not pass QA',()=>{
  assert.deepEqual(states(run()),{product:'complete',design:'complete',architect:'complete',engineer:'complete',qa:'active'});
});
test('repair loop stays with engineering across model tool activity and holds QA',()=>{
  const events=[{stage:'repair',role:'qa',state:'recovering',kind:'handoff'}, {stage:'repair',role:'engineer',state:'running'}, {stage:'team_repair',role:'engineer',state:'running',kind:'tool_call'}];
  const s=states(run({stage:'team_repair',events}));
  assert.equal(s.engineer,'active');assert.equal(s.qa,'waiting');
  const afterHandoff=states(run({events:[...events,{stage:'engineer',role:'engineer',state:'done',kind:'handoff'},{stage:'test',role:'qa',state:'running'}]}));
  assert.equal(afterHandoff.engineer,'complete');assert.equal(afterHandoff.qa,'active');
});
test('waiting for a decision is visible despite an existing document',()=>{
  const s=states(run({status:'awaiting_input',result:{team:docs,pending:{role:'product'}}}));
  assert.equal(s.product,'waiting');
});
test('a verification interruption preserves upstream progress and blocks QA',()=>{
  const s=states(run({status:'error',stage:'error',events:[{stage:'test',role:'qa',state:'running'},{stage:'error',message:'unavailable'}]}));
  assert.equal(s.qa,'blocked');assert.equal(s.engineer,'complete');
});
test('completed independent verification marks all stages complete',()=>{
  assert.deepEqual(Object.values(states(run({status:'done',result:{team:{...docs,qa:{verified:true}}}}))),Array(5).fill('complete'));
});
test('engineer mode locates interrupted verification and does not invent an independent reviewer',()=>{
  const r=run({status:'error',stage:'error',events:[{stage:'plan',message:'{"tasks":["task"]}'},{stage:'code',message:'code'},{stage:'test',message:'checking'},{stage:'error',message:'unavailable'}],result:{draft_files:[{path:'App.jsx',content:'code'}]}});
  assert.deepEqual(states(r,'build'),{plan:'complete',code:'complete',test:'blocked',save:'pending'});
  assert.ok(pipelineStages(r,'build').every(s=>s.role==='engineer'));
});

test('leader schedule controls order, task detail and dispatched active member',()=>{
  const stages=['product','architect','design','engineer','qa'].map(role=>({role,title:'安排 '+role,tasks:['实际任务 '+role],delivery:'实际交付',gatekeeper:role==='engineer'||role==='qa'?'qa':'leader'}));
  const r=run({events:[{stage:'leader',role:'leader',recipient:'architect',kind:'handoff',state:'running'}],result:{team:{leader:{goal:'用户目标',stages},product:{goal:'目标'}}}});
  const pipeline=pipelineStages(r);
  assert.deepEqual(pipeline.map(s=>s.id),['leader','product','architect','design','engineer','qa']);
  assert.equal(pipeline[2].state,'active');
  assert.deepEqual(pipeline[2].tasks,['实际任务 architect']);
  assert.equal(pipeline[2].gatekeeper,'leader');
  assert.equal(pipeline[2].next,'design');
});

test('legacy history retains its five original roles and gates',()=>{
  const stages=pipelineStages(run());
  assert.equal(stages.length,5);
  assert.equal(stages[0].gatekeeper,'product');
  assert.ok(!stages.some(s=>s.role==='leader'));
});

test('leader confirmation and repair handoff remain visible',()=>{
  const waiting=run({agents:{leader:{}},status:'awaiting_input',result:{team:{leader:{summary:'计划'}},pending:{role:'leader'}}});
  assert.equal(states(waiting).leader,'waiting');
  const repairing=run({agents:{leader:{}},stage:'repair',events:[{stage:'repair',role:'leader',recipient:'engineer',kind:'handoff',state:'running'}]});
  assert.equal(states(repairing).engineer,'active');
  assert.equal(states(repairing).qa,'waiting');
});


test('engineer pipeline has no leadership even with a legacy six-role snapshot',()=>{
  for(const value of [null,run({agents:{leader:{}},events:[{role:'leader',stage:'plan',message:'old plan'}]})]){
    const stages=pipelineStages(value,'build');
    assert.equal(stages.length,4);
    assert.ok(stages.every(s=>s.role==='engineer'&&s.gatekeeper==='engineer'));
  }
});
