import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import test from 'node:test';
import ts from 'typescript';
const source=await readFile(new URL('../src/lib/runExperience.ts',import.meta.url),'utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;
const {runExperience}=await import('data:text/javascript;base64,'+Buffer.from(compiled).toString('base64'));
const run=(extra={})=>({status:'running',stage:'code',events:[{role:'engineer',state:'running'}],result:{},error:'',...extra});
test('recovery is distinct from failure and completion overrides old recovery events',()=>{
  assert.equal(runExperience(run()).title,'Neo 正在修改代码');
  const recovering=run({stage:'recovering',events:[{state:'recovering'}]});
  assert.equal(runExperience(recovering).recovering,true);
  assert.equal(runExperience({...recovering,status:'done',result:{version:3}}).title,'v3 已就绪');
  assert.equal(runExperience({...recovering,status:'error'}).active,false);
});
test('terminal issues remain visible and actionable without dumping diagnostics',()=>{
  const failed=run({status:'error',error:'模型输出被截断: internal diagnostic 12000'});
  const summary=runExperience(failed);
  assert.equal(summary.title,'本轮暂未完成');
  assert.match(summary.description,/分步/);
  assert.doesNotMatch(summary.description,/internal diagnostic/);
  assert.match(failed.error,/internal diagnostic/);
  assert.match(runExperience(run({status:'error',error:'模型账户余额不足'})).description,/生成设置/);
  assert.match(runExperience(run({status:'awaiting_input'})).description,/确认卡/);
  assert.match(runExperience(run({status:'review'})).description,/选择/);
});
