import {test} from 'node:test';
import assert from 'node:assert/strict';
import {configuredMaxSteps, validateMaxSteps, testTimeoutMs, jobTimeoutMs} from './test-limits.mjs';

test('configuration accepts bounded integers and has a 1000 step default',()=>{
  assert.equal(configuredMaxSteps('1000'),1000);
  for(const value of [2,1500,10000])assert.equal(validateMaxSteps(value),value);
  for(const value of [true,null,'1000',1,10001,2.5,NaN])assert.throws(()=>validateMaxSteps(value));
  for(const raw of ['', '-1','1','10001','2.5','true','１０００'])assert.throws(()=>configuredMaxSteps(raw));
});
test('long plans receive bounded browser and watchdog budgets',()=>{
  assert.equal(testTimeoutMs(2),60000);
  assert.equal(testTimeoutMs(1000),3030000);
  assert.equal(jobTimeoutMs(1000),3060000);
  assert.equal(testTimeoutMs(10000),30030000);
  assert.equal(testTimeoutMs(1000000),30030000);
});
