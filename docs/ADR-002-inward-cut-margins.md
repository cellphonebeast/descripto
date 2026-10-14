# ADR-002: Cuts shrink inward from the deleted span; kept words keep a 125 ms buffer

**Status:** Accepted
**Date:** 2026-10-14
**Authors:** Carlos
**Project:** descripto

## Context

Exports clipped the beginnings and endings of words that were *kept* whenever a neighbouring
word was deleted. `computeCuts` (`src/lib/edl.ts`) padded each deleted word's range
**outward** by half the inter-word gap, capped at 90 ms. Transcript timestamps from Groq /
whisper are coarse (~50-100 ms) and `word.end` routinely lands before the consonant release,
so with tight gaps the cut started 25 ms after the kept word's recorded end and ate its tail;
the same on the onset side. The render path (`renderFilterGraph`, ADR-001) applies the EDL
ranges exactly, so whatever the EDL says is what is lost.

The capcut rough-cut pipeline (`my-project/capcut/xml_cut.py`, config `CUT_PADDING_*_US`)
solved the identical symptom the other way round: the cut moves **inward** from the removed
span's timestamps by a fixed 125 ms on each side, leaving a sliver of the deleted material as
a buffer for the neighbour, and consecutive removed rows fuse into one run first so no
slivers of removed audio are stranded between them.

## Decision

1. Deleted words are sorted by time and fused into maximal runs of consecutive deleted words.
2. Each run's cut is `[run.start + m, run.end - m]` where `m = KEEP_MARGIN = 0.125 s` on any
   side that touches a kept word. For runs shorter than `2m + MIN_CUT` the margin shrinks so the
   cut is exactly `MIN_CUT` (60 ms) rather than dropped. A leading run cuts from 0; a trailing
   run cuts to `run.end`.
3. The minimum-cut check carries a `1e-9` tolerance: the shrunk margin produces a cut of
   exactly `MIN_CUT` by construction, and IEEE-754 subtraction can land a hair under it
   (`0.02-0.17` gives `0.059999999999999984`), which silently left the word uncut.
4. Unchanged: the `computeCuts` signature (six consumers), the all-deleted
   `[{0, Infinity}]` contract, the merge step, and `computeKeeps` / `sourceToProgram` /
   `programToSource`.

Out of scope, deliberately: audio-RMS snapping of cut points (capcut ADR-030/031) and
transcript-gap silence removal (separate workstream; see the Auphonic duration guard in
ADR-001 s5 for why the hosted `silence_cutter` is not the route).

## Consequences

- A deleted word removes 250 ms less source than before (125 ms survives on each kept side).
  Program duration and seam positions move accordingly; `tests/preview.cjs` fixtures updated.
- Cut boundaries are now independent of the array order of `words`.
- Residual clipping that remains is a timestamp problem, not a padding problem; the next lever
  is RMS snapping, not a larger margin.

## Evidence

- `tests/cuts.cjs` (new, 6 cases) + `tests/preview.cjs`; full suite under Node 24:
  `node --no-experimental-strip-types --test tests/*.cjs` -> tests 37 / pass 37 / fail 0;
  `npx tsc --noEmit -p .` exit 0. Under Node 18 four Auphonic tests fail on `fs.openAsBlob`
  (environmental; `engines.node >= 22.15`).

## Review loop (/review-loop, Astra, think=low)

### Astra round 1 — NOT CLEAN
Medium, `edl.ts` min-cut check: a short deleted run could be dropped by float rounding. Fix:
`>= MIN_CUT - 1e-9` plus a regression. Astra's own example (10/10.15) rounded the safe way on
this engine; a numeric sweep found `0.02-0.17`, which fails without the tolerance (cuts.cjs
pass 5 / fail 1) and passes with it (pass 6 / fail 0).

### Astra round 2 — CLEAN
Prior finding RESOLVED; no new defects in scope. Unlocks a local commit to the fork; push
still needs an explicit yes.
