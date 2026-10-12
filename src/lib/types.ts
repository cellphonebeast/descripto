// ── Core data model ─────────────────────────────────────────────────────────
// A project is a directory under projects/<id>/ containing:
//   source.<ext>     the original uploaded media
//   state.json       canonical editing state (this file's types)
//   renders/         rendered cuts
//   review.json      latest Gemini watch-back review
//   audit.json       latest Haiku transcript audit

export interface Word {
  id: string; // stable id, e.g. "w17"
  text: string; // token as transcribed (may carry punctuation)
  start: number; // seconds in the SOURCE media
  end: number; // seconds in the SOURCE media
  deleted: boolean; // true = this word is cut from the program
  confidence?: number; // 0..1 from the ASR engine, when available
  filler?: boolean; // detected filler word
}

export interface Paragraph {
  id: string; // "p0", "p1", ...
  wordIds: string[]; // ordered
}

export interface ProjectState {
  id: string;
  name: string;
  createdAt: string;
  sourceFile: string; // absolute path
  sourceDuration: number; // seconds
  sourceWidth?: number;
  sourceHeight?: number;
  transcribed: boolean;
  words: Word[];
  paragraphs: Paragraph[];
  studioSound: boolean; // apply audio enhancement on render
  lastRender?: RenderInfo;
  lastReview?: ReviewReport;
  lastAudit?: AuditReport;
}

export interface RenderInfo {
  file: string; // absolute path of rendered mp4
  duration: number; // program duration after cuts
  renderedAt: string;
  studioSound: boolean;
  cutCount: number;
}

export interface ReviewIssue {
  timestamp: number; // seconds into the rendered program
  severity: "info" | "warning" | "error";
  kind: string; // e.g. "jump-cut", "audio-glitch", "pacing"
  note: string;
}

export interface ReviewReport {
  model: string;
  reviewedFile: string;
  summary: string;
  overall: string; // Gemini's free-text overall verdict
  issues: ReviewIssue[];
  reviewedAt: string;
}

export interface AuditCorrection {
  wordId: string;
  current: string;
  suggested: string;
  reason: string;
  confidence: number; // 0..1, Haiku's confidence the fix is right
  applied?: boolean; // once accepted
}

export interface AuditReport {
  model: string;
  corrections: AuditCorrection[];
  notes: string;
  auditedAt: string;
}

export interface RenderJob {
  id: string;
  projectId: string;
  status: "queued" | "running" | "cancelling" | "cancelled" | "done" | "error";
  progress: number; // 0..100
  stage: string;
  output?: string;
  error?: string;
  startedAt: number;
}

export function fmtTime(s: number): string {
  if (!isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, "0")}`;
}
