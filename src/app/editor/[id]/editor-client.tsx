"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { createPlaybackClock, EditedTimeline, VideoControls } from "@/components/edited-playback";
import { Icon, StudioMark } from "@/components/studio-icon";
import { computeCuts, programDuration, sourceToProgram, programToSource, type Range } from "@/lib/edl";
import { nextPreviewTime } from "@/lib/preview";
import { fmtTime, type AuditReport, type ProjectState, type ReviewReport } from "@/lib/types";

type Tab = "review" | "audit" | "agent";

export default function EditorClient({ id, initialProject }: { id: string; initialProject: ProjectState }) {
  const [project, setProject] = useState<ProjectState>(initialProject);
  const clock = useMemo(createPlaybackClock, []);
  const [error, setError] = useState("");
  const [serverStatus, setServerStatus] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [renderProg, setRenderProg] = useState<{ pct: number; stage: string } | null>(null);
  const [renderJobId, setRenderJobId] = useState<string | null>(null);
  const [cancellingRender, setCancellingRender] = useState(false);
  const [exportNotice, setExportNotice] = useState("");
  const cancelPending = useRef(false);
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [tab, setTab] = useState<Tab>("agent");
  const [search, setSearch] = useState("");
  const [hideCuts, setHideCuts] = useState(true);
  const [review, setReview] = useState<ReviewReport | null>(initialProject.lastReview || null);
  const [audit, setAudit] = useState<AuditReport | null>(initialProject.lastAudit || null);
  const [agentCmd, setAgentCmd] = useState("");
  const [agentLog, setAgentLog] = useState<string[]>([]);
  const [playMode, setPlayMode] = useState<"source" | "render">("source");
  const activeWord = useRef<string | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const dragging = useRef(false);
  const previousCuts = useRef<Range[] | null>(null);
  const pendingPreview = useRef<{ time: number; playing: boolean } | null>(null);
  const history = useRef<Map<string, boolean>[]>([]);
  const future = useRef<Map<string, boolean>[]>([]);

  // ── data ─────────────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/projects/${id}`);
      if (!r.ok) throw new Error("Project not found");
      const j = await r.json();
      setProject(j.project);
      setReview(j.project.lastReview || null);
      setAudit(j.project.lastAudit || null);
    } catch (e) {
      setError((e as Error).message || "Could not load this project. Please try again.");
    }
  }, [id]);

  useEffect(() => {
    return (window as any).descripto?.onServerStatus?.((status: string) => {
      setServerStatus(status);
    });
  }, []);

  const words = useMemo(() => project?.words ?? [], [project.words]);
  const wordIndex = useMemo(() => new Map(words.map((word, index) => [word.id, index])), [words]);
  const searchTerm = search.trim().toLocaleLowerCase();
  const matches = words.filter(w => (!hideCuts || !w.deleted) && searchTerm && w.text.toLocaleLowerCase().includes(searchTerm));
  const cuts: Range[] = useMemo(() => computeCuts(words), [words]);
  const progDur = useMemo(
    () => (project ? programDuration(cuts, project.sourceDuration) : 0),
    [cuts, project],
  );
  const deletedCount = words.filter((w) => w.deleted).length;
  const fillerCount = words.filter((w) => w.filler && !w.deleted).length;

  // ── mutations ────────────────────────────────────────────────────────────
  const snapshot = useCallback(() => {
    if (!project) return;
    const snap = new Map(project.words.map((w) => [w.id, w.deleted]));
    history.current.push(snap);
    if (history.current.length > 100) history.current.shift();
    future.current = [];
  }, [project]);

  const mutate = useCallback(
    async (op: string, body: Record<string, unknown>) => {
      const r = await fetch(`/api/projects/${id}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ op, ...body }),
      });
      const j = await r.json();
      if (!r.ok) setError(j.error || "mutation failed");
      else setError("");
      return j;
    },
    [id],
  );

  const refreshFromLocal = useCallback(() => {
    setProject((p) => (p ? { ...p, words: [...p.words] } : p));
  }, []);

  function setDeleted(ids: string[], deleted: boolean) {
    if (!project || ids.length === 0) return;
    snapshot();
    const set = new Set(ids);
    for (const w of project.words) {
      if (set.has(w.id) && w.deleted !== deleted) w.deleted = deleted;
    }
    refreshFromLocal();
    void mutate("setDeleted", { wordIds: ids, deleted });
    setSelection(new Set());
  }

  async function fillers(deleteThem: boolean) {
    if (!project) return;
    snapshot();
    for (const w of project.words) {
      if (w.filler) w.deleted = deleteThem;
    }
    refreshFromLocal();
    await mutate(deleteThem ? "deleteFillers" : "restoreFillers", {});
  }

  function undo() {
    if (!project || history.current.length === 0) return;
    const snap = history.current.pop()!;
    future.current.push(new Map(project.words.map((w) => [w.id, w.deleted])));
    for (const w of project.words) {
      const v = snap.get(w.id);
      if (v !== undefined) w.deleted = v;
    }
    refreshFromLocal();
    void mutate("restoreAll", {}).then(async () => {
      const deletedIds = project.words.filter((w) => w.deleted).map((w) => w.id);
      if (deletedIds.length) await mutate("setDeleted", { wordIds: deletedIds, deleted: true });
    });
  }

  function redo() {
    if (!project || future.current.length === 0) return;
    const snap = future.current.pop()!;
    history.current.push(new Map(project.words.map((w) => [w.id, w.deleted])));
    for (const w of project.words) {
      const v = snap.get(w.id);
      if (v !== undefined) w.deleted = v;
    }
    refreshFromLocal();
    void mutate("restoreAll", {}).then(async () => {
      const deletedIds = project.words.filter((w) => w.deleted).map((w) => w.id);
      if (deletedIds.length) await mutate("setDeleted", { wordIds: deletedIds, deleted: true });
    });
  }

  // Every edit returns an old rendered preview to the current live edit.
  useEffect(() => {
    const previous = previousCuts.current;
    previousCuts.current = cuts;
    if (!previous || JSON.stringify(previous) === JSON.stringify(cuts) || playMode !== "render") return;
    const video = videoRef.current;
    pendingPreview.current = { time: programToSource(previous, video?.currentTime || 0), playing: !!video && !video.paused };
    setPlayMode("source");
  }, [cuts, playMode]);

  // Reconcile immediately on an edit (even paused), at seek/play boundaries,
  // and on animation frames so short deleted words cannot slip between the
  // browser's infrequent timeupdate events.
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !project) return;
    let frame = 0;
    let lastWord: string | null = null;
    let lastPublished = -1;
    const sync = () => {
      if (video.readyState === 0) return;
      if (playMode === "render") { clock.update(video.currentTime, !video.paused); return; }
      if (pendingPreview.current) {
        const pending = pendingPreview.current;
        pendingPreview.current = null;
        video.currentTime = nextPreviewTime(pending.time, cuts, project.sourceDuration);
        if (pending.playing && progDur > 0) void video.play().catch(() => {});
      }
      const time = nextPreviewTime(video.currentTime, cuts, project.sourceDuration);
      if (Math.abs(time - video.currentTime) > 0.0001) video.currentTime = time;
      if (time >= project.sourceDuration || progDur === 0) video.pause();
      if (video.paused || Math.abs(time - lastPublished) >= 0.08) { clock.update(Math.min(progDur, sourceToProgram(cuts, time)), !video.paused); lastPublished = time; }
      const word = words.find(w => !w.deleted && time >= w.start && time < w.end);
      const found = word?.id || null;
      if (found !== activeWord.current) {
        if (activeWord.current) document.getElementById(`word-${activeWord.current}`)?.classList.remove("active");
        if (found) document.getElementById(`word-${found}`)?.classList.add("active");
        activeWord.current = found;
      }
      if (found && found !== lastWord && !video.paused) document.getElementById(`word-${found}`)?.scrollIntoView({ block: "nearest" });
      lastWord = found;
    };
    const tick = () => { sync(); if (!video.paused) frame = requestAnimationFrame(tick); };
    const start = () => { cancelAnimationFrame(frame); tick(); };
    const pause = () => { cancelAnimationFrame(frame); sync(); };
    video.addEventListener("timeupdate", sync);
    video.addEventListener("seeking", sync);
    video.addEventListener("loadedmetadata", sync);
    video.addEventListener("play", start);
    video.addEventListener("pause", pause);
    sync();
    if (!video.paused) start();
    return () => {
      cancelAnimationFrame(frame);
      video.removeEventListener("timeupdate", sync);
      video.removeEventListener("seeking", sync);
      video.removeEventListener("loadedmetadata", sync);
      video.removeEventListener("play", start);
      video.removeEventListener("pause", pause);
    };
  }, [cuts, words, playMode, project.sourceDuration, progDur, clock]);

  function seekSource(time: number) {
    const video = videoRef.current;
    if (!video || !project || progDur === 0) return;
    if (playMode === "render") {
      pendingPreview.current = { time, playing: true };
      setPlayMode("source");
      return;
    }
    video.currentTime = nextPreviewTime(time, cuts, project.sourceDuration);
    void video.play().catch(() => {});
  }

  function seekEdited(time: number) {
    const video = videoRef.current;
    if (!video || progDur === 0) return;
    if (playMode === "render") {
      video.currentTime = Math.min(project.lastRender?.duration || 0, time);
      clock.update(video.currentTime, !video.paused);
    } else {
      video.currentTime = nextPreviewTime(programToSource(cuts, time), cuts, project.sourceDuration);
      clock.update(Math.min(progDur, sourceToProgram(cuts, video.currentTime)), !video.paused);
    }
  }

  // keyboard
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === "TEXTAREA" || target.tagName === "INPUT") return;
      if ((e.key === "Delete" || e.key === "Backspace") && selection.size > 0) {
        e.preventDefault();
        setDeleted([...selection], true);
      } else if (e.key === "z" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        e.shiftKey ? redo() : undo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection, project]);

  // ── word selection via drag ──────────────────────────────────────────────
  function wordMouseDown(e: React.MouseEvent, idx: number) {
    if (e.button !== 0) return;
    dragging.current = true;
    const set = new Set<string>([words[idx].id]);
    setSelection(set);
  }
  function wordMouseEnter(idx: number) {
    if (!dragging.current) return;
    const anchorId = [...selection][0];
    const anchor = words.findIndex((w) => w.id === anchorId);
    if (anchor < 0) return;
    const [a, b] = anchor < idx ? [anchor, idx] : [idx, anchor];
    const set = new Set<string>();
    for (let i = a; i <= b; i++) set.add(words[i].id);
    setSelection(set);
  }
  useEffect(() => {
    const up = () => (dragging.current = false);
    window.addEventListener("mouseup", up);
    return () => window.removeEventListener("mouseup", up);
  }, []);

  // ── actions ──────────────────────────────────────────────────────────────
  async function transcribe() {
    setBusy("Turning your recording into an editable transcript…");
    setError("");
    try {
      const r = await fetch(`/api/projects/${id}/transcribe`, { method: "POST" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  // Reattach to an active export after navigation/reload, so Cancel stays available.
  useEffect(() => {
    let disposed = false;
    void fetch(`/api/projects/${id}/render`).then(r => r.json()).then(job => {
      if (disposed || !job.jobId) return;
      setRenderJobId(job.jobId);
      setRenderProg({ pct: job.progress || 0, stage: job.stage });
      setCancellingRender(job.status === "cancelling");
    }).catch(() => {});
    return () => { disposed = true; };
  }, [id]);

  useEffect(() => {
    if (!renderJobId) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const response = await fetch(`/api/projects/${id}/render?jobId=${renderJobId}`);
        const job = await response.json();
        if (disposed) return;
        if (!response.ok) throw new Error(job.error || "Could not check export status.");
        if (["done", "error", "cancelled"].includes(job.status)) {
          if (job.status === "done") { await load(); if (disposed) return; setPlayMode("render"); }
          else if (job.status === "cancelled") { setExportNotice("Export cancelled. Your edits are saved."); if (job.error) setError(job.error); }
          else setError(job.error || "Export failed.");
          setRenderProg(null); setRenderJobId(null); setCancellingRender(false);
          return;
        }
        setRenderProg({ pct: job.progress ?? 0, stage: job.stage || "Encoding" });
        setCancellingRender(job.status === "cancelling");
      } catch (error) {
        if (disposed) return;
        setError((error as Error).message);
        // A lost job after a server restart is terminal; network loss can recover.
        if (!(error instanceof TypeError)) { setRenderProg(null); setRenderJobId(null); setCancellingRender(false); return; }
      }
      if (!disposed) timer = setTimeout(poll, 500);
    };
    void poll();
    return () => { disposed = true; clearTimeout(timer); };
  }, [renderJobId, id, load]);

  async function stopExport(jobId = renderJobId) {
    cancelPending.current = true;
    setCancellingRender(true);
    if (!jobId) return;
    try {
      const response = await fetch(`/api/projects/${id}/render?jobId=${jobId}`, { method: "DELETE" });
      const job = await response.json();
      if (!response.ok) throw new Error(job.error || "Could not cancel export. Try again.");
      if (job.status === "cancelled") {
        setRenderProg(null); setRenderJobId(null); setCancellingRender(false);
        setExportNotice("Export cancelled. Your edits are saved.");
        if (job.error) setError(job.error);
      }
    } catch (error) { setCancellingRender(false); setError((error as Error).message); }
  }

  async function render() {
    if (renderProg) return;
    setError(""); setExportNotice(""); cancelPending.current = false;
    setRenderProg({ pct: 0, stage: "Starting" });
    try {
      const response = await fetch(`/api/projects/${id}/render`, { method: "POST" });
      const job = await response.json();
      if (!response.ok) throw new Error(job.error);
      setRenderJobId(job.jobId);
      if (cancelPending.current) void stopExport(job.jobId);
    } catch (error) { setRenderProg(null); setCancellingRender(false); setError((error as Error).message); }
  }

  async function runReview() {
    setBusy("Gemini Flash is watching the rendered video…");
    setError("");
    try {
      const r = await fetch(`/api/projects/${id}/review`, { method: "POST" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      setReview(j.report);
      setTab("review");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function runAudit() {
    setBusy("Checking the transcript for corrections…");
    setError("");
    try {
      const r = await fetch(`/api/projects/${id}/audit`, { method: "POST" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      setAudit(j.audit);
      setTab("audit");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function acceptCorrection(wordId: string, suggested: string) {
    if (!project) return;
    await mutate("applyCorrection", { correction: { wordId, suggested } });
    for (const w of project.words) if (w.id === wordId) w.text = suggested;
    if (audit) for (const c of audit.corrections) if (c.wordId === wordId) c.applied = true;
    setAudit({ ...audit! });
    refreshFromLocal();
  }

  async function runAgent() {
    if (!agentCmd.trim()) return;
    setBusy("Your assistant is editing the transcript…");
    setError("");
    snapshot();
    setAgentLog((l) => [...l, `▸ ${agentCmd}`]);
    try {
      const r = await fetch(`/api/projects/${id}/agent`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ command: agentCmd }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      setAgentLog((l) => [...l, j.reply, `(${j.wordsDeleted} words cut · program now ${fmtTime(j.programDuration)})`, ""]);
      await load();
    } catch (e) {
      const message = e instanceof TypeError ? "Connection to Descripto was interrupted. Wait for it to reconnect, then retry your edit." : (e as Error).message;
      setAgentLog((l) => [...l, `✗ ${message}`, ""]);
      setError(message);
      // An interrupted assistant can have saved partial edits; show disk state.
      await load();
    } finally {
      setBusy(null);
    }
  }

  // ── render ────────────────────────────────────────────────────────────────
  if (!project) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-14">
        <p className="text-[var(--text-dim)]">{error || "Loading…"}</p>
        <Link href="/" className="mt-4 inline-block text-[var(--accent)] hover:underline">← back</Link>
      </main>
    );
  }

  const hasRender = !!project.lastRender;
  const videoSrc =
    playMode === "render" && hasRender
      ? `/api/projects/${id}/media?render=1&t=${project.lastRender!.renderedAt}`
      : `/api/projects/${id}/media`;

  const previewDuration = playMode === "render" && project.lastRender ? project.lastRender.duration : progDur;

  return (
    <main className="editor-shell">
      {/* ── top bar ── */}
      <a href="#transcript" className="skip-link">Skip to transcript</a>
      <header className="app-topbar editor-topbar">
        <Link href="/" className="brand" title="All projects"><StudioMark /><span>descripto</span></Link>
        <div className="topbar-divider" />
        <Link href="/" className="breadcrumb">Projects</Link><span className="muted">/</span>
        <span className="editor-project-name" title={project.name}>{project.name}</span>
        <div className="editor-top-actions">
          <Link href="/settings" className="icon-button" aria-label="Settings" title="Settings"><Icon name="settings" size={17} /></Link>
          <button onClick={undo} disabled={!history.current.length} className="icon-button" aria-label="Undo" title="Undo (⌘Z)"><Icon name="undo" size={17} /></button>
          <button onClick={redo} disabled={!future.current.length} className="icon-button" aria-label="Redo" title="Redo (⇧⌘Z)"><Icon name="redo" size={17} /></button>
          <span className="topbar-divider" />
          {project.transcribed && <a href={`/api/projects/${id}/srt`} className="btn-ghost captions-link" title="Download SRT captions"><Icon name="text" size={16} /> Captions</a>}
          {renderProg && <button className="btn-danger" onClick={() => void stopExport()} disabled={cancellingRender}>{cancellingRender ? "Stopping…" : "Cancel export"}</button>}
          <button onClick={render} disabled={!project.transcribed || !!renderProg || !!busy} className="btn-accent export-button"><Icon name="download" size={16} />{renderProg ? `Rendering ${renderProg.pct}%` : "Render video"}</button>
        </div>
      </header>

      {/* progress + status strips */}
      {exportNotice && <div className="server-status" role="status"><span>{exportNotice}</span><button className="btn-ghost" aria-label="Dismiss export notice" onClick={() => setExportNotice("")}><Icon name="close" size={14} /></button></div>}
      {serverStatus && <div className="server-status" role="status">
        <span>{serverStatus === "restarting" ? "Reconnecting to your local studio…" : serverStatus === "failed" ? "The local server could not restart. Close and reopen Descripto. Your saved projects are safe." : "Reconnected. Retry your last action if it did not finish."}</span>
        {serverStatus === "ready" && <button className="btn-ghost" aria-label="Dismiss connection notice" onClick={() => setServerStatus("")}><Icon name="close" size={14} /></button>}
      </div>}
      {renderProg && (
        <div className="shrink-0 bg-[#1c1c1c] px-4 pb-1.5">
          <div className="h-[3px] w-full overflow-hidden rounded bg-[#333]">
            <div className="h-full bg-[var(--accent)] transition-all" style={{ width: `${renderProg.pct}%` }} />
          </div>
          <p className="mt-1 text-[11px] text-[var(--text-dim)]">{renderProg.stage}…</p>
        </div>
      )}
      {(busy || error) && (
        <div role="status" className={`shrink-0 px-4 py-1.5 text-[12px] ${error ? "bg-[#3a1d1d] text-[#ff9d97]" : "bg-[#1d2438] text-[#a9b8ff]"}`}>
          {error || busy}
        </div>
      )}

      <div className="editor-workspace">
        {/* ── left: script + timeline ── */}
        <section className="transcript-panel" aria-label="Transcript editor">
          <div className="panel-heading"><span><Icon name="text" size={16} /> Transcript</span><span className="panel-heading-meta">{words.filter(w => !w.deleted).length} words</span></div>
          <div className="transcript-tools">
            <label className="search-field"><Icon name="search" size={15} /><input aria-label="Find a word in transcript" placeholder="Find a word…" value={search} onChange={e => setSearch(e.target.value)} />{search && <button onClick={() => setSearch("")} aria-label="Clear transcript search"><Icon name="close" size={14} /></button>}</label>
            {searchTerm && <span className="search-count" role="status">{matches.length} matches</span>}
            <button className="btn-ghost cuts-toggle" aria-pressed={!hideCuts} onClick={() => { setHideCuts(!hideCuts); setSelection(new Set()); }}><Icon name="eye" size={15} />{hideCuts ? "Show cuts" : "Hide cuts"}</button>
          </div>
          {/* script document */}
          <div className="script" id="transcript">
            <div className="document-title"><span className="eyebrow">THE SCRIPT</span><h1>{project.name}</h1><p>{project.transcribed ? "Select words to make a cut. Click a word to play from there." : "Turn your recording into a script you can edit."}</p></div>
            {!project.transcribed ? (
              <div className="transcript-empty">
                <span className="empty-icon"><Icon name="wave" size={30} /></span><h2>Every edit starts with a word.</h2><p>Transcribe your recording to find, trim and refine your story.</p>
                <button onClick={transcribe} disabled={!!busy} className="btn-accent mt-5 px-6 py-2.5 text-[14px]">
                  {busy ? "Transcribing…" : "Create transcript"}
                </button>
                <p className="mt-3 text-[12px] text-[var(--text-dim)]">{fmtTime(project.sourceDuration)} of media · word-level</p>
              </div>
            ) : (
              <div className="script-paragraphs">
                {project.paragraphs.map((para) => {
                  const firstId = hideCuts ? para.wordIds.find(wid => !words[wordIndex.get(wid) ?? -1]?.deleted) : para.wordIds[0];
                  const first = words[wordIndex.get(firstId || "") ?? -1];
                  if (hideCuts && para.wordIds.every(wid => words[wordIndex.get(wid) ?? -1]?.deleted)) return null;
                  const last = words[wordIndex.get(para.wordIds[para.wordIds.length - 1]) ?? -1];
                  return (
                    <div key={para.id} className="script-paragraph">
                      <div className="paragraph-gutter">
                        <span className="paragraph-time">
                          {first && last ? `${fmtTime(sourceToProgram(cuts, first.start))}` : ""}
                        </span>
                      </div>
                      <p className="text-[var(--text)]">
                        {para.wordIds.map((wid) => {
                          const idx = wordIndex.get(wid) ?? -1;
                          if (idx < 0) return null;
                          const w = words[idx];
                          if (hideCuts && w.deleted) return null;
                          return (
                            <span
                              key={w.id}
                              id={`word-${w.id}`}
                              className={`word ${w.deleted ? "deleted" : ""} ${w.filler ? "filler" : ""} ${activeWord.current === w.id ? "active" : ""} ${selection.has(w.id) ? "selected" : ""} ${searchTerm && w.text.toLocaleLowerCase().includes(searchTerm) ? "search-match" : ""}`}
                              role="button"
                              tabIndex={0}
                              aria-label={`${w.text}${w.deleted ? ", cut" : ""}, ${fmtTime(sourceToProgram(cuts, w.start))}`}
                              onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); seekSource(w.start); } if (e.key === " ") { e.preventDefault(); setSelection(new Set([w.id])); } }}
                              onMouseDown={(e) => wordMouseDown(e, idx)}
                              onMouseEnter={() => wordMouseEnter(idx)}
                              onClick={() => selection.size <= 1 && seekSource(w.start)}
                            >
                              {w.text}{" "}
                            </span>
                          );
                        })}
                      </p>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* floating selection toolbar */}
          {project.transcribed && selection.size > 0 && (
            <div className="selection-toolbar pointer-events-none">
              <div className="selection-controls pointer-events-auto">
                <span className="pl-2 text-[12px] text-[var(--text-dim)]">{selection.size} selected</span>
                <button
                  onClick={() => setDeleted([...selection], true)}
                  className="btn-danger"
                >
                  Delete ⌫
                </button>
                <button
                  onClick={() => setDeleted([...selection], false)}
                  className="btn-soft"
                >
                  Restore
                </button>
              </div>
            </div>
          )}

          {project.transcribed && <EditedTimeline clock={clock} videoRef={videoRef} duration={progDur} seek={time => {
            if (playMode === "render") {
              pendingPreview.current = { time: programToSource(cuts, time), playing: !videoRef.current?.paused };
              setPlayMode("source");
            } else seekEdited(time);
          }} words={words} cuts={cuts} sourceDuration={project.sourceDuration} />}

        </section>

        {/* ── right: player + actions ── */}
        <aside className="inspector">
          <div className="panel-heading"><span><Icon name="film" size={16} /> Preview</span><span className="panel-heading-meta">{project.sourceWidth && project.sourceHeight ? `${project.sourceWidth} × ${project.sourceHeight}` : "Media"}</span></div>
          {/* player */}
          <div className="preview-panel">
            <div className="preview-tabs">
              <button
                onClick={() => setPlayMode("source")}
                aria-pressed={playMode === "source"}
              >
                Live preview
              </button>
              <button
                onClick={() => hasRender && setPlayMode("render")}
                disabled={!hasRender}
                aria-pressed={playMode === "render"}
              >
                Last export {hasRender ? `· ${fmtTime(project.lastRender!.duration)}` : ""}
              </button>
            </div>
            <div className="video-player">
              <video ref={videoRef} src={videoSrc} preload="auto" playsInline className="preview-video" onError={() => setError("This video could not be loaded. Check that the original media file is still available.")} />
              <VideoControls clock={clock} videoRef={videoRef} duration={previewDuration} seek={seekEdited} />
            </div>
            <p className="mt-2 text-[11px] text-[var(--text-dim)]">
              {playMode === "source" ? "Your cuts are applied live. Ready to export anytime." : "Watching your last rendered export."}
            </p>
          </div>

          {/* actions panel */}
          <div className="inspector-tools">
            <h2 className="tools-heading">Refine your recording</h2>

            {/* Studio Sound card */}
            <div className="card refinement-card flex items-center justify-between">
              <div className="pr-3">
                <p className="text-[13px] font-medium">Studio Sound</p>
                <p className="mt-0.5 text-[11px] leading-snug text-[var(--text-dim)]">Reduce background noise and balance your voice on export. <Link href="/settings" className="underline">Audio settings</Link></p>
              </div>
              <button
                type="button" role="switch" aria-label="Studio Sound" aria-checked={project.studioSound}
                className={`switch ${project.studioSound ? "on" : ""}`}
                onClick={() => {
                  setProject({ ...project, studioSound: !project.studioSound });
                  void mutate("setStudioSound", { studioSound: !project.studioSound });
                }}
              />
            </div>

            {/* Fillers card */}
            <div className="card refinement-card">
              <div className="flex items-center justify-between">
                <p className="text-[13px] font-medium">Filler words</p>
                <span className="filler-count">{fillerCount}</span>
              </div>
              <p className="mt-0.5 text-[11px] leading-snug text-[var(--text-dim)]">Trim the “um”, “uh” and “you know” from your story.</p>
              <div className="mt-2.5 flex gap-2">
                <button onClick={() => fillers(true)} disabled={!fillerCount || !!busy} className="btn-soft px-3 py-1 text-[12px]">Remove all</button>
                <button onClick={() => fillers(false)} disabled={!words.some(w => w.filler && w.deleted) || !!busy} className="btn-soft px-3 py-1 text-[12px]">Restore all</button>
              </div>
            </div>

            {/* AI tabs */}
            <div className="assistant-tabs" role="tablist" aria-label="Editing assistant">
              {(["agent", "review", "audit"] as Tab[]).map((t) => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  role="tab" aria-selected={tab === t} aria-controls={`panel-${t}`} id={`tab-${t}`}
                >
                  <Icon name={t === "review" ? "eye" : t === "audit" ? "check" : "spark"} size={14} />{t === "review" ? "Review" : t === "audit" ? "Proofread" : "Assistant"}
                </button>
              ))}
            </div>

            {tab === "review" && (
              <div className="assistant-content" role="tabpanel" id="panel-review" aria-labelledby="tab-review">
                <button onClick={runReview} disabled={!hasRender || !!busy} className="btn-accent mb-2.5 w-full px-3 py-2 text-[12.5px]">
                  Review rendered video
                </button>
                {!hasRender && <p className="text-[11px] text-[var(--text-dim)]">Render your edit first. The review checks the finished video for rough cuts and audio issues.</p>}
                {review && (
                  <div className="space-y-2">
                    <div className="card review-summary p-3">
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--accent)]">Overall</p>
                      <p className="mt-1 text-[12.5px] leading-relaxed">{review.overall}</p>
                    </div>
                    <p className="text-[11.5px] leading-relaxed text-[var(--text-dim)]">{review.summary}</p>
                    {review.issues.length === 0 && <p className="text-[12px] text-[#4ac267]">No issues reported.</p>}
                    {review.issues.map((iss, i) => (
                      <div
                        key={i}
                        className={`card p-2.5 ${iss.severity === "error" ? "border-[#6d2f2b]" : iss.severity === "warning" ? "border-[#6d5a24]" : ""}`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-mono text-[11px] text-[var(--accent)]">{fmtTime(iss.timestamp)}</span>
                          <span className="rounded-full bg-[#2e2e2e] px-2 py-0.5 text-[10px] text-[var(--text-dim)]">{iss.kind}</span>
                        </div>
                        <p className="mt-1 text-[12px] leading-relaxed">{iss.note}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {tab === "audit" && (
              <div className="assistant-content" role="tabpanel" id="panel-audit" aria-labelledby="tab-audit">
                <button onClick={runAudit} disabled={!project.transcribed || !!busy} className="btn-accent mb-2.5 w-full px-3 py-2 text-[12.5px]">
                  Check transcript
                </button>
                {audit && (
                  <div className="space-y-2">
                    <p className="card p-3 text-[12px] leading-relaxed text-[var(--text-dim)]">{audit.notes}</p>
                    {audit.corrections.length === 0 && <p className="text-[12px] text-[#4ac267]">Transcript is clean.</p>}
                    {audit.corrections.map((c, i) => (
                      <div key={i} className="card p-2.5">
                        <p className="text-[12.5px]">
                          <span className="text-[#ff9d97] line-through">{c.current}</span>
                          {" → "}
                          <span className="text-[#4ac267]">{c.suggested}</span>
                        </p>
                        <p className="mt-0.5 text-[10.5px] text-[var(--text-dim)]">{Math.round(c.confidence * 100)}% · {c.reason}</p>
                        {!c.applied ? (
                          <button onClick={() => acceptCorrection(c.wordId, c.suggested)} className="btn-soft mt-1.5 px-3 py-1 text-[11px]">
                            Accept
                          </button>
                        ) : (
                          <span className="text-[11px] text-[#4ac267]">✓ applied</span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {tab === "agent" && (
              <div className="assistant-content" role="tabpanel" id="panel-agent" aria-labelledby="tab-agent">
                <p className="mb-2 text-[11px] leading-snug text-[var(--text-dim)]">
                  Describe the edit. Your assistant will make the cuts in your transcript.
                </p>
                {!agentLog.length && <div className="assistant-suggestions"><button onClick={() => setAgentCmd("Remove all filler words from this transcript.")}>Remove filler words <Icon name="arrow" size={13} /></button><button onClick={() => setAgentCmd("Find repeated points and suggest cuts before making any changes.")}>Find repeated points <Icon name="arrow" size={13} /></button></div>}
                <div className="edit-composer">
                <textarea
                  aria-label="Describe an edit"
                  value={agentCmd}
                  onChange={(e) => setAgentCmd(e.target.value)}
                  placeholder="What would you like to change?"
                  className="w-full resize-none"
                />
                <div className="composer-actions"><button onClick={runAgent} disabled={!!busy || !agentCmd.trim()} className="btn-accent">
                  Apply edit <Icon name="arrow" size={13} />
                </button></div></div>
                <div className="agent-log mt-3 space-y-1 whitespace-pre-wrap text-[12px] leading-relaxed text-[var(--text-dim)]">
                  {agentLog.map((l, i) => (
                    <p key={i} className={l.startsWith("✗") ? "text-[#ff9d97]" : l.startsWith("▸") ? "text-[var(--accent)]" : ""}>{l}</p>
                  ))}
                </div>
              </div>
            )}
          </div>
        </aside>
      </div>
    </main>
  );
}
