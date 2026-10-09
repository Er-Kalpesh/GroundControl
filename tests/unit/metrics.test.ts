import { it, expect } from 'vitest';
import { spawn } from 'node:child_process';
import { parsePs, sampleGroup } from '../../src/core/metrics.js';
import { waitFor } from '../helpers.js';

it('sums cpu and rss for a process group', () => {
  const out = ' 100  1.5  20480\n 100  0.5  10240\n 200  9.0  99999\n';
  expect(parsePs(out, 100)).toEqual({ cpuPercent: 2, memoryMb: 30 });
  expect(parsePs(out, 300)).toBeNull();
});
it('samples a real process group', async () => {
  const c = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { detached: true, stdio: 'ignore' });
  let mem = 0;
  await waitFor(async () => { mem = (await sampleGroup(c.pid!))?.memoryMb ?? 0; return mem > 5; });   // RSS grows while node boots
  expect(mem).toBeGreaterThan(5);
  process.kill(-c.pid!, 'SIGKILL');
});
