import {test} from 'node:test';
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {jobWatchdog} from './job-watchdog.mjs';

test('stuck work triggers recovery once; completed work cannot restart a later job',async()=>{
  let recovered=0;
  const finish=jobWatchdog(()=>recovered++,10);
  await delay(30);
  assert.equal(recovered,1);
  finish();
  const completed=jobWatchdog(()=>recovered++,10);
  completed();
  await delay(30);
  assert.equal(recovered,1);
});
