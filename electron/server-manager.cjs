const { EventEmitter } = require('node:events');
const { spawn } = require('node:child_process');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

// Own the server process, recover unexpected exits, and stop it on app quit.
// Log lifecycle metadata only: never requests, keys, transcripts, or provider output.
class ServerManager extends EventEmitter {
  constructor(options) { super(); this.options = options; this.child = null; this.stopped = false; this.restarts = []; this.timer = null; }
  log(message) {
    if (!this.options.logPath) return;
    try {
      fs.mkdirSync(path.dirname(this.options.logPath), { recursive: true, mode: 0o700 });
      if (fs.existsSync(this.options.logPath) && fs.statSync(this.options.logPath).size > 256 * 1024) fs.renameSync(this.options.logPath, this.options.logPath + '.previous');
      fs.appendFileSync(this.options.logPath, `${new Date().toISOString()} ${message}\n`, { mode: 0o600 });
    } catch {}
  }
  async start() {
    if (this.stopped) throw new Error('Server has stopped.');
    const child = spawn(this.options.command, this.options.args, { cwd: this.options.cwd, env: this.options.env, stdio: ['ignore', 'ignore', 'ignore'], detached: process.platform !== 'win32' });
    this.child = child;
    this.log(`starting pid=${child.pid || 'pending'}`);
    let exited = false, ready = false;
    const onExit = (code, signal) => {
      if (exited) return;
      exited = true;
      // Children such as ffmpeg inherit this private process group. Clean them
      // up even after an unexpected server exit, before starting a replacement.
      this.killGroup(child);
      if (this.child === child) this.child = null;
      this.log(`exit code=${code ?? 'none'} signal=${signal || 'none'} expected=${this.stopped}`);
      if (ready && !this.stopped) this.recover();
    };
    child.once('exit', onExit);
    child.once('error', () => onExit('spawn-error', null));
    const deadline = Date.now() + (this.options.timeoutMs || 30000);
    while (!this.stopped && !exited && Date.now() < deadline) {
      const healthy = await new Promise(resolve => {
        const req = http.get(this.options.url, res => { res.resume(); resolve(res.statusCode === 200); });
        req.setTimeout(1000, () => req.destroy());
        req.on('error', () => resolve(false));
      });
      if (healthy && !exited && !this.stopped) {
        ready = true; this.log(`ready pid=${child.pid}`); this.emit('status', 'ready'); return;
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    if (!exited) child.kill('SIGTERM');
    throw new Error('Descripto could not start its local server. Restart the app and try again.');
  }
  recover() {
    this.restarts = this.restarts.filter(t => Date.now() - t < 60000);
    if (this.restarts.length >= 3) { this.log('recovery limit reached'); this.emit('status', 'failed'); return; }
    this.restarts.push(Date.now());
    this.emit('status', 'restarting');
    this.timer = setTimeout(() => {
      this.timer = null;
      if (!this.stopped) void this.start().catch(() => { if (!this.stopped) this.recover(); });
    }, this.options.restartDelayMs ?? 500);
  }
  killGroup(child) {
    if (!child?.pid) return;
    try {
      if (process.platform !== 'win32') process.kill(-child.pid, 'SIGKILL');
      else child.kill('SIGKILL');
    } catch {}
  }
  stop() {
    this.stopped = true;
    clearTimeout(this.timer);
    this.killGroup(this.child);
  }
}
module.exports = { ServerManager };
