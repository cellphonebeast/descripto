import { preferences } from "./settings";
import { anthropicBaseUrl, anthropicKey } from "./env";
import type { AuditCorrection, Word } from "./types";

// ── Haiku transcript audit ──────────────────────────────────────────────────
// Sends the word-level transcript (with ASR confidences) to claude-haiku-4-5
// and asks for corrections: punctuation, capitalization, homophones, obvious
// ASR mistakes. Returns structured, per-word suggestions the UI can accept.



export async function auditTranscript(words: Word[], engine: string): Promise<{ corrections: AuditCorrection[]; notes: string; model: string }> {
  const key = anthropicKey();
  const MODEL = preferences().auditModel;
  if (!key) throw new Error("Add your Anthropic API key in Settings → Connections.");

  const kept = words.filter((w) => !w.deleted);
  const lines = kept.map((w) => `${w.id}|${w.text}|${w.start.toFixed(2)}|${w.confidence ?? "n/a"}`).join("\n");

  const system = `You audit machine transcripts (engine: ${engine}). You receive one token per line: id|text|start_seconds|asr_confidence. Propose ONLY high-confidence corrections:
- Punctuation attached to the wrong token, missing sentence punctuation, wrong capitalization of proper nouns/sentence starts.
- Homophone/ASR errors that are clear from context (e.g. "there"/"their", "site"/"sight", "a"/"eh").
- Do NOT rewrite style, tighten wording, change meaning, or merge/split tokens. Do NOT suggest edits to filler words.
Reply with JSON only: {"corrections":[{"wordId":"w12","current":"teh","suggested":"the","reason":"homophone","confidence":0.9}],"notes":"one paragraph about overall transcript quality"}. Max 40 corrections, confidence 0..1. If nothing needs fixing, return an empty list.`;

  const res = await fetch(`${anthropicBaseUrl()}/v1/messages`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 3000,
      system,
      messages: [{ role: "user", content: `Audit this transcript:\n\n${lines}` }],
    }),
  });
  if (!res.ok) throw new Error(`anthropic ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const j: any = await res.json();
  const text: string = j.content?.map((c: any) => c.text || "").join("") || "";
  const jsonStart = text.indexOf("{");
  const parsed = JSON.parse(text.slice(jsonStart, text.lastIndexOf("}") + 1));

  const valid = new Map(kept.map((w) => [w.id, w]));
  const corrections: AuditCorrection[] = [];
  for (const c of parsed.corrections || []) {
    const w = valid.get(String(c.wordId));
    if (!w) continue;
    if (typeof c.suggested !== "string" || c.suggested === w.text) continue;
    corrections.push({
      wordId: w.id,
      current: w.text,
      suggested: c.suggested,
      reason: String(c.reason || "correction"),
      confidence: Math.max(0, Math.min(1, Number(c.confidence) || 0)),
    });
  }
  return { model: MODEL, corrections, notes: String(parsed.notes || "") };
}
