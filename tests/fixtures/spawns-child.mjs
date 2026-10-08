// Fake service that spawns a grandchild, to prove process-group kill works.
import { spawn } from 'node:child_process';
const c = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { stdio: 'inherit' });
console.log('child ' + c.pid);
setInterval(() => {}, 1000);
