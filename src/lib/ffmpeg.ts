import { runProcess } from "./subprocess";
import fs from "fs";
import path from "path";
import type { Range } from "./edl";

// ── ffmpeg helpers ──────────────────────────────────────────────────────────

export interface Probe {
  duration: number;
  width?: number;
  height?: number;
  hasAudio: boolean;
  hasVideo: boolean;
}

export async function probe(file: string, signal?: AbortSignal): Promise<Probe> {
  const args = ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", file];
  const { stdout } = await run("ffprobe", args, signal);
  const j = JSON.parse(stdout);
  const streams: any[] = j.streams || [];
  const v = streams.find((s) => s.codec_type === "video");
  const a = streams.find((s) => s.codec_type === "audio");
  let duration = parseFloat(j.format?.duration || "0");
  if (!isFinite(duration)) duration = parseFloat(v?.duration || "0") || 0;
  return {
    duration,
    width: v?.width,
    height: v?.height,
    hasAudio: !!a,
    hasVideo: !!v,
  };
}

function run(bin: string, args: string[], signal?: AbortSignal) {
  return runProcess(bin, args, { signal });
}

// Render the program: keep `keeps` ranges, optionally apply Studio Sound.
// Single-pass filter_complex: trim/atrim each range, concat, then (optional)
// audio polish chain. Progress is parsed from ffmpeg's -progress pipe.
export function renderProgram(
  source: string,
  out: string,
  keeps: Range[],
  opts: { studioSound: boolean; hasAudio: boolean; total: number; signal?: AbortSignal },
  onProgress: (frac: number, stage: string) => void,
): Promise<void> {
  const n = keeps.length;
  if (n === 0) return Promise.reject(new Error("Nothing to keep — every word is deleted"));

  const filters: string[] = [];
  for (let i = 0; i < n; i++) {
    filters.push(`[0:v]trim=start=${keeps[i].start.toFixed(3)}:end=${keeps[i].end.toFixed(3)},setpts=PTS-STARTPTS[v${i}]`);
  }
  const videoInputs = keeps.map((_, i) => `[v${i}]`).join("");
  filters.push(`${videoInputs}concat=n=${n}:v=1:a=0[vout]`);

  let mapArgs = ["-map", "[vout]"];
  if (opts.hasAudio) {
    for (let i = 0; i < n; i++) {
      filters.push(`[0:a]atrim=start=${keeps[i].start.toFixed(3)}:end=${keeps[i].end.toFixed(3)},asetpts=PTS-STARTPTS[a${i}]`);
    }
    const audioInputs = keeps.map((_, i) => `[a${i}]`).join("");
    const chain = opts.studioSound
      ? `highpass=f=70,afftdn=nf=-25dB,acompressor=threshold=-18dB:ratio=2.5:attack=15:release=200,loudnorm=I=-14:TP=-1.5:LRA=11`
      : "anull";
    filters.push(`${audioInputs}concat=n=${n}:v=0:a=1,${chain}[aout]`);
    mapArgs = mapArgs.concat(["-map", "[aout]"]);
  }

  const args = [
    "-y",
    "-loglevel", "error",
    "-progress", "pipe:1",
    "-nostats",
    "-i", source,
    "-filter_complex", filters.join(";"),
    ...mapArgs,
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-crf", "18",
    "-pix_fmt", "yuv420p",
    "-c:a", "aac",
    "-b:a", "192k",
    "-ar", "48000",
    "-movflags", "+faststart",
    out,
  ];

  return runProcess("ffmpeg", args, { signal: opts.signal, onStdout: s => {
    const m = s.match(/out_time_ms=(\d+)/);
    if (m && !opts.signal?.aborted) onProgress(Math.min(0.99, Number(m[1]) / 1000000 / Math.max(0.1, opts.total)), "Encoding");
  }}).then(() => { onProgress(1, "Done"); });
}

// Extract a mono 16k wav for transcription.
export async function extractAudio(source: string, out: string): Promise<void> {
  await run("ffmpeg", ["-y", "-loglevel", "error", "-i", source, "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", out]);
}

export function fileSize(f: string): number {
  return fs.statSync(f).size;
}

export function ensureDir(d: string): string {
  fs.mkdirSync(d, { recursive: true });
  return d;
}

export function withExt(f: string, ext: string): string {
  return path.join(path.dirname(f), path.basename(f, path.extname(f)) + ext);
}

export async function extractFinishingAudio(video: string, output: string, signal?: AbortSignal) {
  await run("ffmpeg", ["-y", "-i", video, "-vn", "-c:a", "flac", output], signal);
}
export async function replaceAudio(video: string, audio: string, output: string, duration: number, signal?: AbortSignal) {
  await run("ffmpeg", ["-y", "-i", video, "-i", audio, "-map", "0:v:0", "-map", "1:a:0", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-af", "apad", "-t", String(duration), "-movflags", "+faststart", output], signal);
}
