const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const { once } = require('node:events');
const { ServerManager } = require('../electron/server-manager.cjs');
async function freePort() {
  const server = net.createServer().listen(0, '127.0.0.1'); await once(server, 'listening');
  const port = server.address().port; await new Promise(resolve => server.close(resolve)); return port;
}
async function waitUntil(check) {
  const deadline = Date.now() + 5000;
  while (!check() && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20));
  assert.ok(check(), 'condition reached');
}
test('unexpected server exit restarts it; stopping the app does not restart it', async () => {
  const port = await freePort();
  const manager = new ServerManager({ command: process.execPath, args: ['-e', `require('http').createServer((req,res)=>res.end('ok')).listen(${port},'127.0.0.1')`], url: `http://127.0.0.1:${port}`, timeoutMs: 3000, restartDelayMs: 10 });
  const statuses = []; manager.on('status', value => statuses.push(value));
  try {
    await manager.start(); const original = manager.child.pid;
    manager.child.kill('SIGKILL');
    await waitUntil(() => statuses.filter(v => v === 'ready').length === 2);
    assert.notEqual(manager.child.pid, original);
    assert.deepEqual(statuses, ['ready', 'restarting', 'ready']);
    manager.stop(); await waitUntil(() => manager.child === null);
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.deepEqual(statuses, ['ready', 'restarting', 'ready']);
  } finally { manager.stop(); }
});
test('startup failure exits promptly instead of leaving a dead window', async () => {
  const port = await freePort();
  const manager = new ServerManager({ command: process.execPath, args: ['-e', 'process.exit(1)'], url: `http://127.0.0.1:${port}`, timeoutMs: 1000 });
  try { await assert.rejects(manager.start(), /could not start/); } finally { manager.stop(); }
});
test('quitting also stops a server child encoder that ignores SIGTERM', { skip: process.platform === 'win32' }, async () => {
  const port = await freePort();
  const manager = new ServerManager({ command: process.execPath, args: ['-e', `const child=require('child_process').spawn(process.execPath,['-e','process.on("SIGTERM",()=>{});setInterval(()=>{},1000)']); require('http').createServer((req,res)=>res.end(String(child.pid))).listen(${port},'127.0.0.1')`], url: `http://127.0.0.1:${port}`, timeoutMs: 3000 });
  try {
    await manager.start();
    const childPid = Number(await (await fetch(`http://127.0.0.1:${port}`)).text());
    process.kill(childPid, 0);
    manager.stop();
    await waitUntil(() => { try { process.kill(childPid,0); return false; } catch { return true; } });
  } finally { manager.stop(); }
});
