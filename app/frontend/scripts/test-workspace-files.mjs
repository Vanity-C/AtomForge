import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import test from 'node:test';
import ts from 'typescript';
const source=await readFile(new URL('../src/lib/workspaceFiles.ts',import.meta.url),'utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;
const {workspaceFiles}=await import('data:text/javascript;base64,'+Buffer.from(compiled).toString('base64'));
const saved=[{path:'App.jsx',content:'saved'}], drafts=[{path:'App.jsx',content:'generated'},{path:'App.css',content:'css'}];
const run=(status='running',id='one')=>({id,status,result:{draft_files:drafts}});
test('generated files are visible before acceptance and survive failed or interrupted runs',()=>{
  for(const status of ['running','error','cancelled','interrupted']){
    const view=workspaceFiles([],run(status),null,false);
    assert.equal(view.showingDraft,true);
    assert.equal(view.files,drafts);
  }
  assert.deepEqual(workspaceFiles([],null,null,false).files,[]);
});
test('saved and draft views switch without modifying the saved version',()=>{
  assert.equal(workspaceFiles(saved,run(),null,false).files,drafts);
  assert.equal(workspaceFiles(saved,run(),{runId:'one',source:'saved'},false).files,saved);
  assert.equal(workspaceFiles(saved,run(),{runId:'one',source:'draft'},false).files,drafts);
  assert.equal(saved[0].content,'saved');
  assert.equal(workspaceFiles(saved,run('running','two'),{runId:'one',source:'saved'},false).files,drafts);
});
test('unsaved manual editing stays on saved files and completed runs hide old drafts',()=>{
  assert.equal(workspaceFiles(saved,run(),null,true).files,saved);
  assert.equal(workspaceFiles(saved,run(),{runId:'one',source:'draft'},true).showingDraft,false);
  assert.equal(workspaceFiles(saved,run('done'),null,false).files,saved);
  assert.equal(workspaceFiles(saved,run('done'),null,false).hasDraft,false);
});
