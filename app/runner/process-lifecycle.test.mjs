// Run in the runner container with --init; no accounts, network or model calls.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readdir, readFile} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';
import {compile, check} from './server.mjs';

async function browserZombies() {
  const names = (await readdir('/proc')).filter(name => /^\d+$/.test(name));
  const states = await Promise.all(names.map(async pid => {
    try { return await readFile(`/proc/${pid}/status`, 'utf8'); }
    catch (error) { if (error.code === 'ENOENT' || error.code === 'ESRCH') return ''; throw error; }
  }));
  return states.filter(state => /^Name:\s+chrome/m.test(state) && /^State:\s+Z/m.test(state));
}

test('repeated browser verification releases orphan processes', {skip: process.platform !== 'linux'}, async () => {
  const artifact = await compile([{path: 'App.jsx', content:
    'export default function App(){const [count,setCount]=React.useState(0);return <button onClick={()=>setCount(count+1)}>{count}</button>}'}]);
  for (let round = 1; round <= 24; round++) {
    const result = await check(artifact, [
      {action: 'click', selector: 'button'},
      {action: 'text', selector: 'button', value: '1'},
    ]);
    assert.equal(result.ok, true, JSON.stringify(result));
    let zombies = [];
    for (let attempt = 0; attempt < 20; attempt++) {
      zombies = await browserZombies();
      if (!zombies.length) break;
      await delay(50);
    }
    assert.equal(zombies.length, 0, `Round ${round}: browser processes were not reaped; start the container with --init`);
    if (round % 6 === 0) console.log(`Verified ${round} browser lifecycles; no browser zombies`);
  }
});
