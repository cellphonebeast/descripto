const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, filename);
const { captureEdits, applyEdits, createEditQueue } = require('../src/lib/edit-state.ts');
const tick = () => new Promise(resolve => setImmediate(resolve));
function project() { return { studioSound: false, words: [{id:'w0',text:'Hello',start:0,end:1,deleted:false}, {id:'w1',text:'world',start:1,end:2,deleted:false}], lastAudit: { corrections:[{wordId:'w0',suggested:'Hi'}] } }; }
test('atomic history restores text, cuts and audio while protecting timing', () => {
  const p = project(), before = captureEdits(p);
  const edit = captureEdits(p); edit.words[0].text = 'Hi'; edit.words[0].start = 99; edit.words[1].deleted = true; edit.studioSound = true;
  applyEdits(p, edit); assert.equal(p.words[0].start, 0); assert.equal(p.lastAudit.corrections[0].applied, true);
  applyEdits(p, before); assert.deepEqual(captureEdits(p), before); assert.equal(p.lastAudit.corrections[0].applied, false);
});
test('invalid or stale snapshots cannot partially alter a transcript', () => {
  const p = project(), before = captureEdits(p);
  for (const edit of [{words:[],studioSound:false}, {words:[before.words[0],before.words[0]],studioSound:false}, {words:[{...before.words[0], text:''},before.words[1]],studioSound:false}]) {
    assert.throws(() => applyEdits(p, edit)); assert.deepEqual(captureEdits(p), before);
  }
});
test('rapid edits serialize and coalesce without older writes winning', async () => {
  let release; const writes = [], states = [];
  const queue = createEditQueue(async value => { writes.push(value); if (value === 1) await new Promise(resolve => release = resolve); }, status => states.push(status));
  queue.push(1); queue.push(2); queue.push(3); assert.equal(queue.isPending(), true); assert.deepEqual(writes, [1]);
  release(); await tick(); assert.deepEqual(writes, [1,3]); assert.equal(queue.isPending(), false); assert.deepEqual(states, ['saving','saved']);
});
test('failed saves retain the newest local edit and retry it', async () => {
  let reject; let fail = true; const writes = [], states = [];
  const queue = createEditQueue(async value => { writes.push(value); if (fail) await new Promise((_, r) => reject = r); }, (status,error) => states.push([status,error]));
  queue.push('first'); queue.push('latest'); reject(new Error('offline')); await tick();
  assert.equal(queue.isPending(), true); assert.deepEqual(states.at(-1), ['error','offline']);
  fail = false; queue.retry(); await tick(); assert.deepEqual(writes, ['first','latest']); assert.equal(queue.isPending(), false);
});
