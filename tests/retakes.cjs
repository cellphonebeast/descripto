const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, filename);
const { similarity, segmentWords, findRetakes, WINDOWED_THRESHOLD } = require('../src/lib/retakes.ts');
const { DEFAULT_PAUSES } = require('../src/lib/edl.ts');

// One word per 0.3 s; each sentence is its own phrase.
const script = (...sentences) => {
  const words = [];
  for (const s of sentences) for (const t of s.split(' ')) { const i = words.length; words.push({ id: `w${i}`, text: t, start: i * 0.3, end: i * 0.3 + 0.3, deleted: false }); }
  return words;
};
const summary = r => r.map(x => `${x.kind}: ${x.bad.text} -> ${x.good.text}`);

test('similarity matches difflib.SequenceMatcher.ratio on word lists', () => {
  // values computed with python3 difflib on the same inputs
  assert.equal(similarity('a b c d'.split(' '), 'a b x d'.split(' ')), 0.75);
  assert.equal(similarity('so the thing is'.split(' '), 'so the thing is that we'.split(' ')), 0.8);
  assert.equal(+similarity('a b a b c'.split(' '), 'b a b c a'.split(' ')).toFixed(6), 0.8);
  assert.equal(similarity([], ['a']), 0);
});

test('a repeated sentence flags the earlier take and keeps the last', () => {
  const r = findRetakes(script('So here is the whole game today.', 'So here is the whole game.', 'Next topic now.'));
  assert.deepEqual(summary(r), ['adjacent: So here is the whole game today. -> So here is the whole game.']);
});

test('three takes all point to the final one', () => {
  const r = findRetakes(script('The first play is Darnold.', 'The first play is Darnold over.', 'The first play is Darnold over four.'));
  assert.deepEqual(r.map(x => x.good.text), ['The first play is Darnold over four.', 'The first play is Darnold over four.']);
});

test('a false start that the next phrase restarts is flagged (prefix)', () => {
  const r = findRetakes(script('So the first play guys is.', 'So the first play I am taking is Darnold over four.'));
  assert.equal(r.length, 1);
  assert.equal(r[0].kind, 'prefix');
});

test('negation and different figures are different statements, not retakes', () => {
  assert.deepEqual(findRetakes(script('I am taking that one.', 'I am not taking that one.')), []);
  assert.deepEqual(findRetakes(script('Take a look at the 54.5 on the under.', 'Take a look at the 47.5 on the under.')), []);
});

test('a restart phrase marks the phrase that says it', () => {
  const r = findRetakes(script('Wait let me try that again.', 'Darnold goes over.'));
  assert.deepEqual(summary(r), ['keyword: Wait let me try that again. -> Darnold goes over.']);
});

test('words already cut (deleted, or inside a cut pause) are never compared', () => {
  const words = script('So here is the whole game today.', 'So here is the whole game.');
  assert.equal(findRetakes(words, [], [{ start: words[6].start, end: words[11].end }]).length, 0); // keeper is inside a cut
  for (const w of words.slice(0, 7)) w.deleted = true; // the bad take is gone once cut
  assert.equal(findRetakes(words).length, 0);
});

test('a long pause splits a phrase even without punctuation', () => {
  const words = script('one two three four five six');
  assert.equal(segmentWords(words).length, 1);
  // whisper stretches words over silence: the pause goes after the last word whose midpoint precedes its own (0.95)
  assert.deepEqual(segmentWords(words, [{ start: 0.5, end: 1.4 }]).map(s => s.text), ['one two three', 'four five six']);
  assert.equal(segmentWords(words, [{ start: 0.6, end: 1.35 }]).length, 1); // 0.75 s < 0.8 s
});

test('a chain never ends on a keeper the negation or figure checks would reject', () => {
  // A -> B (adjacent), B -> C (restart phrase): consolidation must not pair A with C
  for (const [a, b, c] of [['I like this plan.', 'I like this plan start over.', 'I do not like this plan.'], ['The line is 5 points.', 'The line is 5 points start over.', 'The line is 7 points.']]) {
    const r = findRetakes(script(a, b, c));
    assert.ok(!r.some(x => x.bad.text === a), summary(r).join('; '));
    assert.deepEqual(r.filter(x => x.bad.text === b).map(x => x.kind), ['keyword']);
  }
});

test('a straggler rejected by one keeper is still matched to a later one', () => {
  const r = findRetakes(script(
    'Darnold goes over 4 rushing yards.', 'Alpha bravo charlie.', 'Delta echo foxtrot.', 'Golf hotel india.',
    'Darnold goes over 5 rushing yards.', 'Darnold goes over 5 rushing yards.', 'Juliet kilo lima.', 'Mike november oscar.', 'Papa quebec romeo.',
    'Darnold goes over 4 rushing yards tonight.', 'Darnold goes over 4 rushing yards tonight.'));
  const x = r.find(p => p.bad.text === 'Darnold goes over 4 rushing yards.');
  assert.ok(x, summary(r).join('; '));
  assert.equal(x.kind, 'straggler');
  assert.equal(x.good.wordIds[0], r.find(p => p.bad.text === 'Darnold goes over 4 rushing yards tonight.').good.wordIds[0]);
});

test('signs and leading points are part of a figure; a trailing full stop is not', () => {
  assert.deepEqual(findRetakes(script('We said the value is -5.', 'We said the value is 5.')), []);
  assert.deepEqual(findRetakes(script('We said the value is .5 again.', 'We said the value is 5 again.')), []);
  assert.equal(findRetakes(script('We said the value is 5.', 'We said the value is 5 again.')).length, 1);
});

// A crude tokenizer, just to assert (independently of the implementation's own `tokens()`)
// that the filler phrases below genuinely don't resemble each other or the real phrase.
const wtok = (s) => s.toLowerCase().split(' ');

test('a windowed match 3 phrases later is flagged; the same match 4 phrases later is not', () => {
  const real = 'Darnold goes over four and a half yards tonight for the team.';
  const retake = 'Darnold goes over four and a half yards tonight for the squad.';
  const fillerA = 'Alpha bravo charlie delta echo foxtrot golf hotel.';
  const fillerB = 'Kilo lima mike november oscar papa quebec romeo.';
  const fillerC = 'Uniform victor whiskey xray yankee zulu apple banana.';

  // Guard: fillers must be dissimilar to each other and to the real phrase, and the
  // real/retake pair must actually clear WINDOWED_THRESHOLD, or this test proves nothing.
  for (const f of [fillerA, fillerB, fillerC]) {
    assert.ok(similarity(wtok(real), wtok(f)) < WINDOWED_THRESHOLD, `filler too similar to real: ${f}`);
  }
  assert.ok(similarity(wtok(fillerA), wtok(fillerB)) < WINDOWED_THRESHOLD, 'fillers too similar to each other');
  assert.ok(similarity(wtok(fillerB), wtok(fillerC)) < WINDOWED_THRESHOLD, 'fillers too similar to each other');
  assert.ok(similarity(wtok(fillerA), wtok(fillerC)) < WINDOWED_THRESHOLD, 'fillers too similar to each other');
  assert.ok(similarity(wtok(real), wtok(retake)) >= WINDOWED_THRESHOLD, 'real/retake pair must clear the windowed threshold');
  // Neither phrase contains a negation word or a figure, so the compatibility guards
  // (negation parity, figure parity) can never be the reason a pairing is rejected here.

  // Distance 3 (i=0, j=3): inside the WINDOW=3 lookahead -> flagged as "windowed".
  const r3 = findRetakes(script(real, fillerA, fillerB, retake));
  assert.deepEqual(summary(r3), [`windowed: ${real} -> ${retake}`]);

  // Distance 4 (i=0, j=4): one phrase further than the windowed pass looks -> not flagged.
  const r4 = findRetakes(script(real, fillerA, fillerB, fillerC, retake));
  assert.deepEqual(r4, []);
});

test('segmentWords splits a long punctuation-free, pause-free run every SEGMENT_MAX_WORDS words', () => {
  const thirty = Array.from({ length: 30 }, (_, i) => `word${i}`).join(' ');
  const words = script(thirty);
  const segs = segmentWords(words);
  assert.deepEqual(segs.map((s) => s.wordIds.length), [25, 5]);
  assert.equal(segs[0].wordIds[0], 'w0');
  assert.equal(segs[0].wordIds[24], 'w24');
  assert.equal(segs[1].wordIds[0], 'w25');
  assert.equal(segs[1].wordIds[4], 'w29');
});

test('a restart-phrase pair is kind "keyword" with similarity 1 even sharing no words', () => {
  const r = findRetakes(script('Scratch that.', 'Banana kayak umbrella forest.'));
  assert.equal(r.length, 1);
  assert.equal(r[0].kind, 'keyword');
  assert.equal(r[0].similarity, 1);
  const badWords = new Set(r[0].bad.text.toLowerCase().replace(/[.]/g, '').split(' '));
  const goodWords = new Set(r[0].good.text.toLowerCase().replace(/[.]/g, '').split(' '));
  assert.equal([...badWords].filter((w) => goodWords.has(w)).length, 0, 'bad/good should share no words');
});

test('DEFAULT_PAUSES matches ADR-005: disabled by default, minGap 1, margin 0.25', () => {
  assert.deepEqual(DEFAULT_PAUSES, { enabled: false, minGap: 1.0, margin: 0.25 });
});
