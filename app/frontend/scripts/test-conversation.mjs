import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('../src/lib/conversation.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {compilerOptions: {target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022}}).outputText;
const {groupConversation,currentOutputFiles} = await import('data:text/javascript;base64,' + Buffer.from(compiled).toString('base64'));
const message = (id, kind, extra = {}) => ({id, kind, run_id: 'run-1', sender: 'engineer', recipient: 'all', content: kind, detail: {}, created: '2026-09-12T00:00:00Z', ...extra});

test('tool file links support both output formats, deduplicate, and exclude unavailable files', () => {
  assert.deepEqual(currentOutputFiles({files:['App.jsx',{path:'index.css',bytes:30},'App.jsx','deleted.js','https://external.test',{path:1},null]},['App.jsx','index.css']),['App.jsx','index.css']);
  for (const output of [null,0,'App.jsx',{}, {files:'App.jsx'}]) assert.deepEqual(currentOutputFiles(output,['App.jsx']),[]);
});

test('tool start/result become one step while the final reply stays outside the trace', () => {
  const result = message(3, 'tool_result', {detail: {call_id: 'a', output: false}});
  const [reply] = groupConversation([message(1, 'plan'), message(2, 'tool_start', {detail: {call_id: 'a'}}), result, message(4, 'summary')]);
  assert.equal(reply.steps.length, 2);
  assert.equal(reply.steps[1].result, result);
  assert.equal(reply.answer.id, 4);
});
test('roles, runs, user input and finished replies form distinct groups', () => {
  const items = [message(1, 'plan'), message(2, 'plan', {sender: 'qa'}), message(3, 'plan', {run_id: 'run-2'}), message(4, 'decision', {sender: 'user'}), message(5, 'summary'), message(6, 'activity')];
  assert.deepEqual(groupConversation(items).map(g => g.id), [1, 2, 3, 4, 5, 6]);
});
test('a paginated orphan tool result is retained and pairs when earlier history loads', () => {
  const result = message(2, 'tool_result', {detail: {call_id: 'a'}});
  assert.equal(groupConversation([result])[0].steps[0].message.id, 2);
  const groups = groupConversation([message(1, 'tool_start', {detail: {call_id: 'a'}}), result]);
  assert.equal(groups[0].steps.length, 1);
  assert.equal(groups[0].steps[0].result.id, 2);
});
test('interleaved role events do not orphan a tool result', () => {
  const groups = groupConversation([message(1, 'tool_start', {detail: {call_id: 'a'}}), message(2, 'plan', {sender: 'qa'}), message(3, 'tool_result', {detail: {call_id: 'a', state: 'error'}})]);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].steps[0].result.detail.state, 'error');
});
test('unmatched tools without a call id are not falsely paired', () => {
  const [group] = groupConversation([message(1, 'tool_start'), message(2, 'tool_result')]);
  assert.equal(group.steps.length, 2);
  assert.equal(group.steps[0].result, undefined);
});
test('latest role outcome is visible and earlier review details remain expandable', () => {
  const [group] = groupConversation([message(1, 'result'), message(2, 'activity'), message(3, 'result')]);
  assert.equal(group.answer.id, 3);
  assert.deepEqual(group.steps.map(s => s.message.id), [1, 2]);
});
test('legacy engineer logs and handoff-only replies keep their last update visible', () => {
  assert.equal(groupConversation([message(1, 'activity'), message(2, 'activity')])[0].answer.id, 2);
  assert.equal(groupConversation([message(1, 'handoff', {recipient: 'qa'})])[0].answer.recipient, 'qa');
});
