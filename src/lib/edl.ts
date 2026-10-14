import type { Word, Paragraph } from "./types";

// ── Edit decision list math ─────────────────────────────────────────────────
// Deleted words become time ranges to cut from the source. Consecutive deleted
// words fuse into one run, and each run's cut shrinks INWARD by KEEP_MARGIN on
// any side that touches a kept word: transcript timestamps run early/late by
// ~100 ms, so leaving a sliver of the deleted span protects the neighbour's
// consonant release and onset. Padding never widens a cut into a kept word.
// Overlapping/adjacent ranges merge.

export interface Range {
  start: number;
  end: number;
}

const KEEP_MARGIN = 0.125; // seconds of the deleted span left beside a kept word
const MIN_CUT = 0.06; // ignore absurdly tiny cuts

export function computeCuts(words: Word[]): Range[] {
  const ordered = [...words].sort((a, b) => a.start - b.start || a.end - b.end);
  const deleted = ordered.filter((w) => w.deleted);
  if (deleted.length === 0) return [];
  if (deleted.length === ordered.length) return [{ start: 0, end: Infinity }];

  const raw: Range[] = [];
  let i = 0;
  while (i < ordered.length) {
    if (!ordered[i].deleted) { i++; continue; }
    const first = i;
    let last = i;
    while (last + 1 < ordered.length && ordered[last + 1].deleted) last++;
    i = last + 1;
    const runStart = ordered[first].start;
    const runEnd = Math.max(...ordered.slice(first, last + 1).map((w) => w.end));
    const leftKept = first > 0;
    const rightKept = last + 1 < ordered.length;
    const sides = (leftKept ? 1 : 0) + (rightKept ? 1 : 0);
    const margin = sides ? Math.max(0, Math.min(KEEP_MARGIN, (runEnd - runStart - MIN_CUT) / sides)) : 0;
    const start = leftKept ? runStart + margin : 0;
    const end = rightKept ? runEnd - margin : runEnd;
    if (end - start >= MIN_CUT - 1e-9) raw.push({ start, end });
  }

  const merged: Range[] = [];
  for (const r of raw) {
    const last = merged[merged.length - 1];
    if (last && r.start <= last.end + 0.001) {
      last.end = Math.max(last.end, r.end);
    } else {
      merged.push({ ...r });
    }
  }
  return merged;
}

// Inverse: the segments of the source that survive.
export function computeKeeps(cuts: Range[], total: number): Range[] {
  const keeps: Range[] = [];
  let t = 0;
  for (const c of cuts) {
    const end = Math.min(c.start, total);
    if (end - t > 0.01) keeps.push({ start: t, end });
    t = Math.max(t, c.end);
    if (t >= total) return keeps;
  }
  if (total - t > 0.01) keeps.push({ start: t, end: total });
  return keeps;
}

export function programDuration(cuts: Range[], total: number): number {
  return computeKeeps(cuts, total).reduce((a, k) => a + (k.end - k.start), 0);
}

// Map a source time -> program time (after cuts).
export function sourceToProgram(cuts: Range[], t: number): number {
  let acc = 0;
  for (const c of cuts) {
    if (t <= c.start) return acc + Math.max(0, t);
    if (t < c.end) return acc + c.start; // inside a cut -> lands at its start
    acc -= c.end - c.start;
  }
  return Math.max(0, t + acc);
}

// Map a program time -> source time (for seeking from the transcript).
export function programToSource(cuts: Range[], t: number): number {
  let remaining = t;
  let prevEnd = 0;
  for (const c of cuts) {
    const span = c.start - prevEnd;
    if (remaining <= span) return prevEnd + remaining;
    remaining -= span;
    prevEnd = c.end;
  }
  return prevEnd + remaining;
}

// ── Filler detection ────────────────────────────────────────────────────────
const FILLERS = new Set([
  "um", "uh", "erm", "hmm",
  "like",
  "basically", "actually", "literally", "honestly", "seriously", "obviously",
  "sorta", "kinda",
]);

// Multi-word fillers matched on lowercase token runs.
const PHRASE_FILLERS = [
  ["you", "know"],
  ["i", "mean"],
  ["sort", "of"],
  ["kind", "of"],
  ["at", "the", "end", "of", "the", "day"],
];

const strip = (s: string) => s.toLowerCase().replace(/[^a-z']/g, "");

export function markFillers(words: Word[]): void {
  for (const w of words) w.filler = false;
  const n = words.length;
  for (let i = 0; i < n; i++) {
    const t = strip(words[i].text);
    if (!t) continue;
    if (FILLERS.has(t)) {
      words[i].filler = true;
      continue;
    }
    for (const phrase of PHRASE_FILLERS) {
      let ok = true;
      for (let j = 0; j < phrase.length; j++) {
        if (i + j >= n || strip(words[i + j].text) !== phrase[j]) {
          ok = false;
          break;
        }
      }
      if (ok) {
        for (let j = 0; j < phrase.length; j++) words[i + j].filler = true;
        break;
      }
    }
  }
}

// Group words into paragraphs: sentence punctuation ends a paragraph, and so
// does a silence gap longer than gapSec.
export function buildParagraphs(words: Word[], gapSec = 1.4): Paragraph[] {
  const paras: Paragraph[] = [];
  let cur: string[] = [];
  const flush = (idx: number) => {
    if (cur.length) {
      paras.push({ id: `p${paras.length}`, wordIds: cur });
      cur = [];
    }
    void idx;
  };
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    cur.push(w.id);
    const next = words[i + 1];
    const ends = /[.!?]["')\]]?$/.test(w.text.trim());
    const gap = next ? next.start - w.end : Infinity;
    if (ends || gap > gapSec) flush(i);
  }
  flush(words.length - 1);
  return paras;
}

// ── SRT export (kept words only) ────────────────────────────────────────────
function srtStamp(t: number): string {
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = Math.floor(t % 60);
  const ms = Math.round((t - Math.floor(t)) * 1000);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(ms).padStart(3, "0")}`;
}

export function toSRT(words: Word[], cuts: Range[]): string {
  const kept = words.filter((w) => !w.deleted);
  const chunks: Word[][] = [];
  let cur: Word[] = [];
  for (let i = 0; i < kept.length; i++) {
    const w = kept[i];
    if (cur.length > 0) {
      const gap = w.start - cur[cur.length - 1].end;
      if (gap > 0.8 || cur.length >= 14) {
        chunks.push(cur);
        cur = [];
      }
    }
    cur.push(w);
  }
  if (cur.length) chunks.push(cur);

  const lines: string[] = [];
  chunks.forEach((chunk, i) => {
    const start = sourceToProgram(cuts, chunk[0].start);
    const end = sourceToProgram(cuts, chunk[chunk.length - 1].end);
    lines.push(`${i + 1}`);
    lines.push(`${srtStamp(start)} --> ${srtStamp(Math.max(end, start + 0.4))}`);
    lines.push(chunk.map((w) => w.text).join(" "));
    lines.push("");
  });
  return lines.join("\n");
}
