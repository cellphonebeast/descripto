# Learnings

Bug-fix and surprise forensics. Format: Date / Symptom / Root Cause / Fix Applied / Prevention.

## 2026-10-14 — Transcript timestamps carry no pause information

- **Symptom:** padding rules and transcript-gap silence detection did nothing or starved cuts.
- **Root Cause:** Groq whisper returns contiguous spans. Latest project: 1358 of 1470 inter-word
  gaps exactly 0, 31 negative (overlaps); p10/p50/p90 all 0. Measured from `state.json`.
- **Fix Applied:** boundaries snapped to the audio at transcription (ADR-003); pauses read from the
  audio envelope, not from word gaps.
- **Prevention:** before any cut/pause rule, print the gap quantiles of the real transcript.

## 2026-10-14 — A fixed -40 dBFS "silence" floor would have cut real speech

- **Symptom:** dry run of Tighten pauses at -40 dBFS / >= 1.0 s found 38 pauses, 226 s, and 31 of
  them contained transcribed words; the audio speech guard (>= 200 ms above -35 dBFS) skipped 0.
- **Root Cause:** this recording's speech is quiet. Envelope inside word spans: p10 -66.8,
  p50 -35.0, p90 -25.9 dBFS. -40 sits near the speech median.
- **Fix Applied:** floor -50 dBFS; a sound >= 20 ms ends a pause.
- **Prevention:** measure speech vs non-speech levels on the real WAV before choosing a floor.
  Never take dBFS constants from another recording setup (capcut's -40 was tuned elsewhere).

## 2026-10-14 — "No transcribed word inside" blocked obviously silent pauses

- **Symptom:** 12-65 s of dead air left in the export with the word guard on.
- **Root Cause:** whisper stretches a word across the following silence (227-239 s: every hop
  below -50 dBFS, yet "is." spanned into it), and puts words on near-silence ("Thank you. Let's
  get right into that." peaking -54 to -69 dBFS while real speech peaks about -28; likely
  hallucination, not confirmed).
- **Fix Applied:** pauses decided by audio alone (ADR-005, pending).
- **Prevention:** do not use word spans as a speech witness on zero-gap transcripts; check a
  word's own audio level before trusting it.

## 2026-10-14 — Background sound between words is rare and short; no rule change

- **Symptom:** Carlos heard background sound in the export where he was not talking.
- **Root Cause (measured, pmv8bmero5904aa):** non-word hops p10 -99 / p50 -80 / p90 -58.5 dBFS.
  The -50 dBFS rule already cuts 194.2 of the 214.7 s in no-speech stretches >= 2 s. What stays
  is 26.1 s in 32 gaps of 0.6-1.9 s with bursts peaking -25 to -30 dBFS (speech level).
- **Fix Applied:** none. Dry run of "bridge loud runs that touch no spoken word": < 0.2 s gains
  8 s and puts -31 dBFS inside cuts; < 0.5 s gains 10 s at -26 dBFS. Carlos: rare, skip it.
- **Prevention:** before tuning detection, measure what the export KEEPS (kept no-speech gaps),
  not just what the rule finds; a fix that cuts speech-level audio needs timestamps from the
  listener first.
