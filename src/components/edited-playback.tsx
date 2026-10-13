"use client";

import { memo, useEffect, useMemo, useState, useSyncExternalStore, type RefObject } from "react";
import { Icon } from "./studio-icon";
import { sourceToProgram, type Range } from "@/lib/edl";
import { fmtTime, type Word } from "@/lib/types";

// Only playback controls subscribe to this clock. Thousands of transcript words
// and the rest of the editor do not rerender on every playback tick.
export function createPlaybackClock() {
  let state = { time: 0, playing: false };
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => state,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    update(time: number, playing: boolean) {
      if (time === state.time && playing === state.playing) return;
      state = { time, playing };
      listeners.forEach(listener => listener());
    },
  };
}
type Clock = ReturnType<typeof createPlaybackClock>;
type PlaybackProps = {
  clock: Clock;
  videoRef: RefObject<HTMLVideoElement | null>;
  duration: number;
  seek: (time: number) => void;
  onToggle?: () => void;
};
function seekKey(event: React.KeyboardEvent<HTMLInputElement>, time: number, duration: number, seek: (time: number) => void) {
  const value = event.key === "ArrowLeft" || event.key === "ArrowDown" ? time - 5 : event.key === "ArrowRight" || event.key === "ArrowUp" ? time + 5 : event.key === "Home" ? 0 : event.key === "End" ? duration : null;
  if (value !== null) { event.preventDefault(); seek(Math.min(duration, Math.max(0, value))); }
}
function useClock(clock: Clock) {
  return useSyncExternalStore(clock.subscribe, clock.getSnapshot, clock.getSnapshot);
}
function toggle(video: HTMLVideoElement | null, duration: number, time: number, seek: (time: number) => void) {
  if (!video || !duration) return;
  if (video.paused) {
    if (video.ended || time >= duration - 0.025) seek(0);
    void video.play().catch(() => {});
  } else video.pause();
}

export function VideoControls({ clock, videoRef, duration, seek }: PlaybackProps) {
  const { time, playing } = useClock(clock);
  const [muted, setMuted] = useState(false);
  useEffect(() => { const video = videoRef.current; if (!video) return; const sync = () => setMuted(video.muted); sync(); video.addEventListener("volumechange", sync); return () => video.removeEventListener("volumechange", sync); }, [videoRef]);
  const elapsed = Math.min(duration, Math.max(0, time));
  return <div className="video-controls">
    <input className="edited-seek" type="range" aria-label="Video position" aria-valuetext={`${fmtTime(elapsed)} of ${fmtTime(duration)}`} min={0} max={duration || 1} step={0.01} value={elapsed} disabled={!duration} onKeyDown={e => seekKey(e, elapsed, duration, seek)} onChange={e => seek(Number(e.target.value))} />
    <div className="video-control-row">
      <button className="icon-button" aria-label={playing ? "Pause video" : "Play video"} disabled={!duration} onClick={() => toggle(videoRef.current, duration, time, seek)}><Icon name={playing ? "pause" : "play"} size={17} /></button>
      <span className="video-time">{fmtTime(elapsed)} <b>/ {fmtTime(duration)}</b></span>
      <span className="video-edit-label">Edited video</span>
      <button className="icon-button" aria-label={muted ? "Unmute video" : "Mute video"} onClick={() => { const video = videoRef.current; if (video) { video.muted = !video.muted; setMuted(video.muted); } }}><Icon name={muted ? "muted" : "volume"} size={17} /></button>
      <button className="icon-button" aria-label="Full screen" onClick={() => { const player = videoRef.current?.parentElement; if (document.fullscreenElement) void document.exitFullscreen().catch(() => {}); else if (player) void player.requestFullscreen().catch(() => {}); }}><Icon name="fullscreen" size={16} /></button>
    </div>
  </div>;
}

// The lane is static during playback; only its separate playhead moves.
const WordLane = memo(function WordLane({ words, cuts, duration }: { words: Word[]; cuts: Range[]; duration: number }) {
  return <>{words.filter(w => !w.deleted).map(w => {
    const start = sourceToProgram(cuts, w.start);
    const end = sourceToProgram(cuts, w.end);
    return <div key={w.id} title={`${w.text} · ${fmtTime(start)}`} className={`tl-word absolute top-1.5 h-8 ${w.filler ? "bg-[#c8b67a]" : "bg-[#629b8c]"}`} style={{ left: `${100 * start / (duration || 1)}%`, width: `${Math.max(0.035, 100 * (end - start) / (duration || 1))}%` }} />;
  })}</>;
});

export function EditedTimeline({ clock, videoRef, duration, seek, words, cuts, sourceDuration, onToggle }: PlaybackProps & { words: Word[]; cuts: Range[]; sourceDuration: number }) {
  const { time, playing } = useClock(clock);
  const elapsed = Math.min(duration, Math.max(0, time));
  const ticks = useMemo(() => duration ? Array.from({ length: 7 }, (_, i) => duration * i / 6) : [0], [duration]);
  const deletedCount = useMemo(() => words.filter(w => w.deleted).length, [words]);
  return <div className="editor-timeline select-none">
    <div className="timeline-toolbar">
      <div className="transport"><button className="transport-play" disabled={!duration} aria-label={playing ? "Pause preview" : "Play preview"} onClick={() => onToggle ? onToggle() : toggle(videoRef.current, duration, time, seek)}><Icon name={playing ? "pause" : "play"} size={15} /></button><span>{fmtTime(elapsed)} <b>/ {fmtTime(duration)}</b></span></div>
      <span className="timeline-summary"><Icon name="cut" size={13} /> {deletedCount} words cut <span>·</span> {fmtTime(Math.max(0, sourceDuration - duration))} removed</span>
      <span className="timeline-legend">Edited timeline <i /> Words <i className="cut" /> Edits</span>
    </div>
    <div className="edited-ruler">{ticks.map((time, index) => <span key={index}>{fmtTime(time)}</span>)}</div>
    <div className="timeline-track">
      <div className="timeline-lane relative h-11 overflow-hidden" aria-hidden="true">
        <WordLane words={words} cuts={cuts} duration={duration} />
        {cuts.map((cut, index) => <div key={index} className="edit-seam" style={{ left: `${100 * sourceToProgram(cuts, cut.start) / (duration || 1)}%` }} />)}
        <div className="playhead pointer-events-none absolute top-0 h-11 w-[1.5px]" style={{ left: `${100 * elapsed / (duration || 1)}%` }} />
      </div>
      <input className="timeline-seek" type="range" aria-label="Edited timeline position" aria-valuetext={`${fmtTime(elapsed)} of ${fmtTime(duration)}`} min={0} max={duration || 1} step={0.01} value={elapsed} disabled={!duration} onKeyDown={e => seekKey(e, elapsed, duration, seek)} onChange={e => seek(Number(e.target.value))} />
    </div>
    <div className="timeline-caption">{duration ? "Cuts are removed from this timeline." : "All words removed. Undo or restore words to keep editing."}<span>{fmtTime(duration)} total</span></div>
  </div>;
}
