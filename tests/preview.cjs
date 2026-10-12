const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, filename);
const { nextPreviewTime } = require('../src/lib/preview.ts');
const { sourceToProgram, programDuration } = require('../src/lib/edl.ts');
test('a paused playhead in a new cut immediately advances past it', () => {
  assert.equal(nextPreviewTime(3.2, [{start:3,end:4}], 10), 4.001);
  assert.equal(nextPreviewTime(2, [{start:3,end:4}], 10), 2);
});
test('adjacent cuts, final cuts and an entirely removed recording stay bounded', () => {
  assert.equal(nextPreviewTime(1, [{start:1,end:2},{start:2,end:3}], 10), 3.001);
  assert.equal(nextPreviewTime(9, [{start:8,end:12}], 10), 10);
  assert.equal(nextPreviewTime(1, [{start:0,end:Infinity}], 10), 10);
  assert.equal(nextPreviewTime(1, [], 0), 0);
});
test('the edited clock and duration remove cut time immediately', () => {
  const cuts = [{start:1,end:3},{start:5,end:6}];
  assert.equal(programDuration(cuts, 10), 7);
  assert.equal(sourceToProgram(cuts, 4), 2);
  assert.equal(sourceToProgram(cuts, 8), 5);
});

test('edited timeline seeks map back to the surviving source at every cut boundary', () => {
  const { programToSource } = require('../src/lib/edl.ts');
  const cuts = [{start:0,end:2}, {start:4,end:6}, {start:9,end:12}];
  const duration = programDuration(cuts, 12);
  assert.equal(duration, 5);
  for (const program of [0, 0.5, 1.99, 2, 2.1, 4.9, 5]) {
    const source = nextPreviewTime(programToSource(cuts, program), cuts, 12);
    assert.ok(source >= 2 && source <= 12);
    assert.ok(Math.abs(Math.min(duration, sourceToProgram(cuts, source)) - program) <= 0.0011);
  }
});

test('cut word blocks collapse to seams and undo restores the original timeline', () => {
  const { computeCuts } = require('../src/lib/edl.ts');
  const words = Array.from({length:4}, (_, i) => ({id:`w${i}`, text:`word${i}`, start:i, end:i+1, deleted:false}));
  words[1].deleted = true;
  const cuts = computeCuts(words);
  assert.equal(programDuration(cuts, 4), 3);
  assert.equal(sourceToProgram(cuts, words[2].start), 1);
  assert.equal(sourceToProgram(cuts, words[1].start), sourceToProgram(cuts, words[1].end));
  words[1].deleted = false;
  assert.equal(programDuration(computeCuts(words), 4), 4);
  words.forEach(w => w.deleted = true);
  assert.equal(programDuration(computeCuts(words), 4), 0);
  assert.equal(sourceToProgram(computeCuts(words), 4), 0);
});
