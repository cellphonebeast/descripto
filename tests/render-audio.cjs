const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, filename);
const { renderProgram, probe } = require('../src/lib/ffmpeg.ts');
test('built-in Studio Sound exports real audio and video with edited timing', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'descripto-studio-test-'));
  try {
    const source = path.join(dir, 'source.mp4'), output = path.join(dir, 'edited.mp4');
    execFileSync('ffmpeg', ['-v','error','-y','-f','lavfi','-i','color=size=128x72:rate=25:duration=3','-f','lavfi','-i','sine=frequency=440:duration=3','-c:v','libx264','-preset','ultrafast','-c:a','aac','-shortest',source]);
    await renderProgram(source, output, [{start:0,end:0.87},{start:2,end:3}], {studioSound:true,hasAudio:true,total:1.87}, () => {});
    const info = await probe(output);
    assert.ok(info.hasAudio); assert.ok(info.hasVideo);
    assert.ok(Math.abs(info.duration - 1.87) < 0.05, `Expected 1.87s after cut, received ${info.duration}s`);
    assert.ok(fs.statSync(output).size > 1000);
  } finally { fs.rmSync(dir, {recursive:true, force:true}); }
});
