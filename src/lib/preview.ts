import type { Range } from "./edl";

// A cut can be made while paused, during playback, or while scrubbing.
// Always land on the next kept frame, bounded by the source duration.
export function nextPreviewTime(time: number, cuts: Range[], duration: number): number {
  const end = Number.isFinite(duration) ? Math.max(0, duration) : 0;
  let next = Math.min(end, Math.max(0, time));
  for (const cut of cuts) {
    if (next < cut.start) break;
    if (next < cut.end) next = Math.min(end, cut.end + 0.001);
  }
  return next;
}
