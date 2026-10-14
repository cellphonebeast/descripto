const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, filename);
const { computeCuts } = require('../src/lib/edl.ts');

const word = (id, start, end, deleted = false) => ({ id, text: id, start, end, deleted });
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} !== ${b}`);

test('a cut never reaches into the gap beside a kept word, even with tight gaps', () => {
  const words = [word('A', 0.5, 1.0), word('D', 1.05, 1.4, true), word('C', 1.45, 2.0)];
  const [cut] = computeCuts(words);
  near(cut.start, 1.05 + 0.125);
  near(cut.end, 1.4 - 0.125);
  assert.ok(cut.start > words[0].end + 0.1, 'tail of A is protected');
  assert.ok(cut.end < words[2].start - 0.1, 'onset of C is protected');
});

test('consecutive deleted words fuse into one run with margins only at the kept edges', () => {
  const words = [word('A', 0, 1), word('D1', 1, 2, true), word('D2', 2.4, 3, true), word('C', 3, 4)];
  assert.deepEqual(computeCuts(words), [{ start: 1.125, end: 2.875 }]);
});

test('a short deleted word is still cut, with margins shrunk rather than dropped', () => {
  const words = [word('A', 0, 1), word('a', 1, 1.15, true), word('C', 1.15, 2)];
  const [cut] = computeCuts(words);
  near(cut.end - cut.start, 0.06);
  near(cut.start - 1, 1.15 - cut.end);
});

test('a short deleted run late in the recording survives float rounding of the minimum cut', () => {
  // 0.02–0.17 makes end-start evaluate to 0.059999999999999984 under IEEE-754.
  const cuts = computeCuts([word('A', 0, 0.02), word('D', 0.02, 0.17, true), word('C', 0.17, 1)]);
  assert.equal(cuts.length, 1);
  near(cuts[0].end - cuts[0].start, 0.06);
});

test('leading and trailing deletions cut to the edge of the recording', () => {
  const lead = computeCuts([word('D', 0.3, 1, true), word('C', 1, 2)]);
  assert.deepEqual(lead, [{ start: 0, end: 0.875 }]);
  const trail = computeCuts([word('A', 0, 1), word('D', 1, 1.7, true)]);
  assert.deepEqual(trail, [{ start: 1.125, end: 1.7 }]);
});

test('cuts are independent of the array order of words', () => {
  const words = [word('C', 2, 3), word('D', 1, 2, true), word('A', 0, 1)];
  assert.deepEqual(computeCuts(words), [{ start: 1.125, end: 1.875 }]);
});
