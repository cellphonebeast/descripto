const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, filename);
const { isRemoveFillersCommand, removeDetectedFillers, assistantResultError } = require('../src/lib/assistant-command.ts');
test('exact filler removal runs locally; qualified and non-editing requests do not', () => {
  for (const command of ['Remove all filler words from this transcript.', 'remove filler words', 'Please cut all the filler words!', 'Delete the filler words from my transcript']) assert.equal(isRemoveFillersCommand(command), true, command);
  for (const command of ['Do not remove filler words', 'Remove filler words except like', 'Find filler words', 'Suggest how to remove filler words', 'Remove all filler words from this transcript. Keep um.']) assert.equal(isRemoveFillersCommand(command), false, command);
});
test('local filler removal preserves previous cuts and other words, and is idempotent', () => {
  const words = [{ id: 'a', filler: true, deleted: false }, { id: 'b', filler: false, deleted: false }, { id: 'c', filler: true, deleted: true }, { id: 'd', filler: false, deleted: true }];
  const before = structuredClone(words);
  assert.equal(removeDetectedFillers(words), 1);
  assert.deepEqual(words, before.map(w => w.id === 'a' ? { ...w, deleted: true } : w));
  assert.equal(removeDetectedFillers(words), 0);
});
test('assistant result failures are reported instead of false success', () => {
  assert.equal(assistantResultError({ type: 'result', subtype: 'success', is_error: false }), null);
  assert.ok(assistantResultError({ type: 'result', subtype: 'error_max_turns', is_error: true }));
  assert.ok(assistantResultError({ type: 'result', subtype: 'success', is_error: true }));
});
