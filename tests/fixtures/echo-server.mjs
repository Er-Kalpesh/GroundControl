// Fake service: logs a tick every 200ms, serves "ok" over HTTP, exits cleanly on SIGTERM.
import http from 'node:http';
const port = Number(process.env.PORT ?? 0);
http.createServer((_, res) => res.end('ok')).listen(port, '127.0.0.1', () => console.log('listening ' + port));
setInterval(() => console.log('tick'), 200);
process.on('SIGTERM', () => { console.log('bye'); process.exit(0); });
