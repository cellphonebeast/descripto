const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, filename);
const { runProcess } = require('../src/lib/subprocess.ts');
const { startRender, activeRender, findRender, cancelRender } = require('../src/lib/render-jobs.ts');

test('cancellation kills a stubborn encoder and waits for its exit', async () => {
  const controller = new AbortController();
  let pid;
  const operation = runProcess(process.execPath, ['-e', 'process.on("SIGTERM",()=>{}); console.log(process.pid); setInterval(()=>{},1000)'], { signal: controller.signal, onStdout: text => { pid = Number(text.trim()); controller.abort(); } });
  await assert.rejects(operation, { name: 'AbortError' });
  assert.ok(pid > 0);
  assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
});
test('a cancelled job cannot publish success, duplicate renders reuse one job, and cancellation is project scoped', async () => {
  let published = false;
  const task = startRender('cancel-test', async (job, signal) => {
    await runProcess(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { signal });
    published = true;
  });
  assert.equal(startRender('cancel-test', async () => {}).job.id, task.job.id);
  assert.equal(findRender('another-project', task.job.id), undefined);
  assert.equal(await cancelRender('another-project', task.job.id), undefined);
  const job = await cancelRender('cancel-test', task.job.id);
  assert.equal(job.status, 'cancelled');
  assert.equal(published, false);
  assert.equal(activeRender('cancel-test'), undefined);
  assert.equal((await cancelRender('cancel-test', task.job.id)).status, 'cancelled');
  const retry = startRender('cancel-test', async () => {});
  await retry.finished;
  assert.equal(retry.job.status, 'done');
  assert.notEqual(retry.job.id, task.job.id);
});
test('cancelling a completed export preserves its result', async () => {
  const task = startRender('done-test', async job => { job.output = 'completed.mp4'; });
  await task.finished;
  const job = await cancelRender('done-test', task.job.id);
  assert.equal(job.status, 'done');
  assert.equal(job.output, 'completed.mp4');
});
