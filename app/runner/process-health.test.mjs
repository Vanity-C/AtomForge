import {test} from 'node:test';
import assert from 'node:assert/strict';
import {processHealth} from './process-health.mjs';

test('cgroup v2 stops admitting browsers before tasks are exhausted',()=>{
  const read=path=>path.endsWith('current')?'218\n':'256\n';
  assert.deepEqual(processHealth(read),{current:218,limit:256,pressure:true});
});
test('normal task use is healthy',()=>{
  assert.equal(processHealth(path=>path.endsWith('current')?'26':'256').pressure,false);
});
test('cgroup v1 falls back to its pids controller',()=>{
  const read=path=>{if(!path.includes('/pids/'))throw Error('ENOENT');return path.endsWith('current')?'236':'256';};
  assert.equal(processHealth(read).pressure,true);
});
test('non Linux and unlimited controllers do not claim resource failure',()=>{
  assert.equal(processHealth(()=>{throw Error('ENOENT');}).pressure,false);
  assert.equal(processHealth(path=>path.endsWith('current')?'12':'max').pressure,false);
});
