const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, filename);
const { parseWav, envelopeDbfs, refineBoundary, snapWordBoundaries } = require('../src/lib/audio-envelope.ts');

const RATE = 16000;
// segments: [seconds, amplitude] — amplitude 0 is silence, else a 220 Hz tone.
function samples(segments) {
  const out = [];
  for (const [sec, amp] of segments) for (let i = 0; i < Math.round(sec * RATE); i++) out.push(Math.round(amp * Math.sin((2 * Math.PI * 220 * out.length) / RATE)));
  return Int16Array.from(out);
}
function wav(s, { rate = RATE, channels = 1, bits = 16, list = true } = {}) {
  const fmt = Buffer.alloc(24);
  fmt.write('fmt ', 0); fmt.writeUInt32LE(16, 4); fmt.writeUInt16LE(1, 8); fmt.writeUInt16LE(channels, 10);
  fmt.writeUInt32LE(rate, 12); fmt.writeUInt32LE(rate * channels * bits / 8, 16); fmt.writeUInt16LE(channels * bits / 8, 20); fmt.writeUInt16LE(bits, 22);
  const extra = list ? Buffer.concat([Buffer.from('LIST'), Buffer.from([5, 0, 0, 0]), Buffer.from('INFOx'), Buffer.from([0])]) : Buffer.alloc(0); // odd size + pad byte
  const data = Buffer.alloc(8 + s.length * 2);
  data.write('data', 0); data.writeUInt32LE(s.length * 2, 4);
  for (let i = 0; i < s.length; i++) data.writeInt16LE(s[i], 8 + i * 2);
  const body = Buffer.concat([Buffer.from('WAVE'), fmt, extra, data]);
  const head = Buffer.alloc(8); head.write('RIFF', 0); head.writeUInt32LE(body.length, 4);
  return Buffer.concat([head, body]);
}
const loud = 0.3 * 32767;

test('parses a mono PCM16 WAV past a LIST chunk and rejects other formats', () => {
  const s = samples([[0.1, loud]]);
  const pcm = parseWav(wav(s));
  assert.equal(pcm.sampleRate, RATE);
  assert.deepEqual(Array.from(pcm.samples), Array.from(s));
  assert.throws(() => parseWav(wav(s, { channels: 2 })), /unsupported WAV/);
  assert.throws(() => parseWav(wav(s, { rate: 44100 })), /unsupported WAV/);
  assert.throws(() => parseWav(Buffer.from('not a wav file')), /RIFF/);
});

test('a truncated or odd-length data chunk is rejected, not read as silence', () => {
  const full = wav(samples([[0.1, loud]]));
  assert.throws(() => parseWav(full.subarray(0, full.length - 2)), /truncated WAV data chunk/);
  const odd = wav(samples([[0.1, loud]]));
  const at = odd.indexOf('data');
  odd.writeUInt32LE(odd.readUInt32LE(at + 4) - 1, at + 4); // 3199 bytes declared, all present
  assert.throws(() => parseWav(odd), /incomplete sample/);
});

test('envelope is one dBFS value per 10 ms hop', () => {
  const env = envelopeDbfs(parseWav(wav(samples([[0.1, loud], [0.1, 0]]))));
  assert.equal(env.length, 20);
  assert.ok(env[5] > -15 && env[5] < -10, `tone hop ${env[5]}`);
  assert.equal(env[15], -Infinity);
});

test('snaps to the onset of sustained silence near the target', () => {
  // tone 0–1.0 s, silence 1.0–1.2 s, tone after
  const pcm = parseWav(wav(samples([[1.0, loud], [0.2, 0], [1.0, loud]])));
  assert.equal(refineBoundary(pcm, 1_100_000, 500_000, 1_700_000), 1_000_000);
  assert.equal(refineBoundary(pcm, 950_000, 500_000, 1_700_000), 1_000_000);
});

test('without a held silence it snaps to the quietest hop, clamped to [lo, hi]', () => {
  // a 30 ms dip is shorter than the 60 ms hold
  const pcm = parseWav(wav(samples([[1.0, loud], [0.03, 0], [1.0, loud]])));
  assert.equal(refineBoundary(pcm, 1_050_000, 500_000, 1_700_000), 1_000_000);
  assert.equal(refineBoundary(pcm, 1_050_000, 1_020_000, 1_700_000), 1_020_000);
  assert.equal(refineBoundary(pcm, 1_050_000, 1_200_000, 1_100_000), 1_200_000); // empty range → clamped target (lo wins, as in the Python)
  assert.equal(refineBoundary(null, 2_000_000, 0, 1_000_000), 1_000_000); // no audio → clamped target
});

test('touching and overlapping pairs share one snapped boundary; real gaps are left alone', () => {
  // tone 0–1.0, silence 1.0–1.2, tone 1.2–2.0, silence 2.0–2.5, tone 2.5–3.0
  const pcm = parseWav(wav(samples([[1.0, loud], [0.2, 0], [0.8, loud], [0.5, 0], [0.5, loud]])));
  const words = [
    { start: 0.2, end: 1.1 }, // touches next at 1.1 (inside the silence)
    { start: 1.1, end: 2.1 }, // overlaps next by 0.1
    { start: 2.0, end: 2.3 }, // real gap of 0.2 to next
    { start: 2.5, end: 2.9 },
  ];
  assert.equal(snapWordBoundaries(words, pcm), 2);
  assert.equal(words[0].end, 1.0); assert.equal(words[1].start, 1.0);
  assert.equal(words[1].end, 2.0); assert.equal(words[2].start, 2.0);
  assert.equal(words[2].end, 2.3); assert.equal(words[3].start, 2.5);
  assert.deepEqual(words.map(w => [w.rawStart, w.rawEnd]), [[0.2, 1.1], [1.1, 2.1], [2.0, 2.3], [2.5, 2.9]]);
  for (const w of words) assert.ok(w.end > w.start);
});

test('a word too short to keep 30 ms on each side is not moved', () => {
  const pcm = parseWav(wav(samples([[1.0, loud]])));
  const words = [{ start: 0.5, end: 0.54 }, { start: 0.54, end: 0.56 }];
  assert.equal(snapWordBoundaries(words, pcm), 0);
  assert.deepEqual(words.map(w => [w.start, w.end]), [[0.5, 0.54], [0.54, 0.56]]);
});
