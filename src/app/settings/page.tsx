"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Icon, StudioMark } from "@/components/studio-icon";

type Provider = "gemini" | "auphonic" | "groq" | "anthropic";
type Connection = { configured: boolean; source: string };
type Preferences = { audioProcessor: string; agentAuth: string; geminiModel: string; auditModel: string; agentModel: string };
type Settings = { connections: Record<Provider, Connection>; preferences: Preferences };
const providers: { id: Provider; name: string; role: string; detail: string; url: string; glyph: string }[] = [
  { id: "gemini", name: "Google Gemini", role: "Video review", detail: "Watch back your rendered video and catch awkward cuts, pacing and sync issues.", url: "https://aistudio.google.com/apikey", glyph: "✦" },
  { id: "auphonic", name: "Auphonic", role: "Audio finishing", detail: "Level your voice and clean up background noise with Studio Sound.", url: "https://auphonic.com/engine/api/", glyph: "≋" },
  { id: "groq", name: "Groq", role: "Transcription", detail: "Turn recordings into editable, word-by-word transcripts with Whisper.", url: "https://console.groq.com/keys", glyph: "g" },
  { id: "anthropic", name: "Anthropic", role: "AI editing & proofreading", detail: "Proofread your transcript and make edits by asking the assistant.", url: "https://platform.claude.com/settings/keys", glyph: "A" },
];
export default function SettingsPage() {
  const [data, setData] = useState<Settings | null>(null);
  const [keys, setKeys] = useState<Partial<Record<Provider, string>>>({});
  const [visible, setVisible] = useState<Partial<Record<Provider, boolean>>>({});
  const [messages, setMessages] = useState<Record<string, { text: string; error?: boolean }>>({});
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [backPath, setBackPath] = useState("/");
  useEffect(() => { const path = new URLSearchParams(window.location.search).get("returnTo"); if (path && /^\/editor\/p[a-z0-9]+$/.test(path)) setBackPath(path); }, []);
  const [advanced, setAdvanced] = useState(false);
  async function load() {
    try { const res = await fetch("/api/settings", { cache: "no-store" }); const body = await res.json(); if (!res.ok) throw new Error(body.error); setData(body); setError(""); }
    catch { setError("Could not load your connections. Please try again."); }
  }
  useEffect(() => { void load(); }, []);
  async function save(payload: object, scope: string, message: string) {
    if (busy) return;
    setBusy(scope); setMessages(m => ({ ...m, [scope]: { text: "" } }));
    try {
      const res = await fetch("/api/settings", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const body = await res.json(); if (!res.ok) throw new Error(body.error);
      setData(body); setKeys(k => ({ ...k, [scope]: "" })); setVisible(v => ({ ...v, [scope]: false }));
      setMessages(m => ({ ...m, [scope]: { text: message } }));
    } catch (e) { setMessages(m => ({ ...m, [scope]: { text: (e as Error).message, error: true } })); }
    finally { setBusy(""); }
  }
  async function test(provider: Provider) {
    if (busy) return;
    setBusy(provider); setMessages(m => ({ ...m, [provider]: { text: "Checking connection…" } }));
    try {
      const res = await fetch("/api/settings/test", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ provider, ...(keys[provider]?.trim() ? { key: keys[provider]!.trim() } : {}) }) });
      const body = await res.json(); if (!res.ok) throw new Error(body.error);
      setMessages(m => ({ ...m, [provider]: { text: `${body.message}${keys[provider]?.trim() ? " Save this key to use it." : ""}` } }));
    } catch (e) { setMessages(m => ({ ...m, [provider]: { text: (e as Error).message, error: true } })); }
    finally { setBusy(""); }
  }
  return <main className="settings-shell">
    <header className="app-topbar"><Link href="/" className="brand"><StudioMark /><span>descripto</span></Link><div className="topbar-divider" /><span className="muted text-[12px]">Settings</span><Link className="btn-ghost settings-back" href={backPath}><Icon name="back" size={14} /> {backPath === "/" ? "Back to projects" : "Back to editor"}</Link></header>
    <div className="settings-layout">
      <aside className="settings-nav"><span className="settings-eyebrow">WORKSPACE</span><a href="#connections" className="settings-nav-active"><Icon name="settings" size={16} /> Connections</a><p>Your tools.<br />Your accounts.</p></aside>
      <section id="connections" className="settings-content">
        <div className="settings-heading"><div><h1>Connections</h1><p>Bring your own keys. Make this studio yours.</p></div><span className="settings-count">{data ? Object.values(data.connections).filter(c => c.configured).length : "—"} / 4 configured</span></div>
        <div className="settings-note"><Icon name="key" size={17} /><p>Connect only what you need. Keys are saved locally for your computer account and never included in project files. Changes apply immediately.</p></div>
        {error && <div className="error-banner" role="alert">{error}<button className="btn-soft" onClick={load}>Retry</button></div>}
        {!data && !error && <p role="status" className="muted">Loading connections…</p>}
        {data && <>
          <div className="connections-grid">{providers.map(p => {
            const c = data.connections[p.id]; const draft = !!keys[p.id]?.trim();
            return <section className="connection-card" key={p.id} aria-labelledby={`${p.id}-heading`}>
              <div className="connection-header"><span className={`provider-glyph provider-${p.id}`} aria-hidden="true">{p.glyph}</span><div><h2 id={`${p.id}-heading`}>{p.name}</h2><span>{p.role}</span></div><span className={`connection-badge ${c.configured ? "configured" : ""}`}><i />{c.configured ? "Configured" : "Not connected"}</span></div>
              <p className="connection-description">{p.detail}</p>
              <label className="key-label" htmlFor={`${p.id}-key`}>API key <span>{c.source === "saved" ? "Saved on this computer" : c.source === "environment" ? "Using environment key" : c.source === "disabled" ? "Disconnected" : ""}</span></label>
              <div className="key-field"><input disabled={!!busy} onKeyDown={e => { if (e.key === "Enter" && draft && !busy) { e.preventDefault(); void save({ provider: p.id, action: "save", key: keys[p.id], ...(p.id === "anthropic" ? { preferences: { agentAuth: "key" } } : {}) }, p.id, "Key saved. Ready to use."); } }} id={`${p.id}-key`} type={visible[p.id] ? "text" : "password"} autoComplete="off" spellCheck={false} value={keys[p.id] || ""} onChange={e => { setKeys(k => ({ ...k, [p.id]: e.target.value })); setMessages(m => ({ ...m, [p.id]: { text: "" } })); }} placeholder={c.configured ? "Paste a replacement key" : "Paste your API key"} /><button className="icon-button" aria-label={`${visible[p.id] ? "Hide" : "Show"} ${p.name} key`} disabled={!draft} onClick={() => setVisible(v => ({ ...v, [p.id]: !v[p.id] }))}><Icon name="eye" size={16} /></button></div>
              <div className="connection-actions"><button className="btn-accent" disabled={!!busy || !draft} onClick={() => save({ provider: p.id, action: "save", key: keys[p.id], ...(p.id === "anthropic" ? { preferences: { agentAuth: "key" } } : {}) }, p.id, p.id === "anthropic" ? "Key saved. Assistant now uses your API account." : "Key saved. Ready to use.")}>Save key</button><button className="btn-soft" disabled={!!busy || (!draft && !c.configured)} onClick={() => test(p.id)}>{busy === p.id ? "Working…" : "Test connection"}</button><a className="get-key-link" href={p.url} target="_blank" rel="noreferrer">Get a key <Icon name="arrow" size={12} /></a></div>
              <p className={`connection-message ${messages[p.id]?.error ? "is-error" : ""}`} role="status">{messages[p.id]?.text || ""}</p>
              <div className="connection-secondary">{c.configured && <button disabled={!!busy} onClick={() => save({ provider: p.id, action: "remove" }, p.id, "Disconnected. Stored key removed.")}>Disconnect</button>}{(c.source === "saved" || c.source === "disabled") && <button disabled={!!busy} onClick={() => save({ provider: p.id, action: "environment" }, p.id, "Using environment configuration when available.")}>Use environment instead</button>}</div>
            </section>;
          })}</div>
          <section className="settings-preferences"><div><h2>Studio Sound</h2><p>Choose how your audio is finished when Studio Sound is on.</p></div><select aria-label="Studio Sound processor" value={data.preferences.audioProcessor} disabled={!!busy} onChange={e => save({ preferences: { audioProcessor: e.target.value } }, "audio", "Audio preference saved.")}><option value="local">Built-in · runs locally</option><option value="auphonic">Auphonic · uses your account</option></select><p className="settings-preference-note">{data.preferences.audioProcessor === "auphonic" ? `${data.connections.auphonic.configured ? "" : "Add an Auphonic key above to enable rendering. "}Audio is sent to Auphonic during rendering and uses your Auphonic credits. Timing and edits are preserved.` : "Local noise reduction and voice leveling. No account or cloud upload needed."}</p><p role="status" className={messages.audio?.error ? "is-error" : "connection-message"}>{messages.audio?.text}</p></section>
          <section className="settings-preferences"><div><h2>Editing assistant</h2><p>Use your Anthropic key or an existing Claude CLI sign-in.</p></div><select aria-label="Assistant authentication" value={data.preferences.agentAuth} disabled={!!busy} onChange={e => save({ preferences: { agentAuth: e.target.value } }, "auth", "Assistant preference saved.")}><option value="signin">Existing Claude sign-in</option><option value="key">Anthropic API key</option></select><p className="settings-preference-note">{data.preferences.agentAuth === "key" ? "Assistant edits use the Anthropic key above and are billed to that API account." : "Requires Claude CLI to be signed in on this computer. New users can choose Anthropic API key instead."}</p><p role="status" className={messages.auth?.error ? "is-error" : "connection-message"}>{messages.auth?.text}</p></section>
          <button className="advanced-toggle" aria-expanded={advanced} onClick={() => setAdvanced(!advanced)}>Model settings <Icon name="chevron" size={14} /></button>
          {advanced && <form className="model-settings" onSubmit={e => { e.preventDefault(); const f = new FormData(e.currentTarget); void save({ preferences: Object.fromEntries(f) }, "models", "Models saved."); }}>{([['geminiModel', 'Gemini review model'], ['auditModel', 'Transcript proofreader model'], ['agentModel', 'Editing assistant model']] as const).map(([key, label]) => <label key={key}>{label}<input disabled={!!busy} name={key} defaultValue={data.preferences[key]} required pattern="[a-zA-Z0-9._-]+" maxLength={100} /></label>)}<button className="btn-soft" disabled={!!busy}>Save models</button><p role="status" className={messages.models?.error ? "is-error" : "connection-message"}>{messages.models?.text}</p></form>}
          <p className="settings-footnote">Keys are stored in a private settings file with access limited to your computer account. They are not encrypted. Service usage is billed by each provider.</p>
        </>}
      </section>
    </div>
  </main>;
}
