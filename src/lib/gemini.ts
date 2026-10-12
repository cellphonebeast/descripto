import { preferences } from "./settings";
import fs from "fs";
import { googleKey } from "./env";
import type { ReviewIssue, ReviewReport } from "./types";

// ── Gemini Flash watch-back review ──────────────────────────────────────────
// Sends the rendered program to gemini-2.5-flash and asks it to actually
// WATCH it: check for jump cuts, glitches, dead air, pacing, sync problems.
// Small files go inline; large files use the Files API (resumable upload).



async function filesApiUpload(file: string, key: string): Promise<string> {
  const size = fs.statSync(file).size;
  const meta = JSON.stringify({ file: { display_name: file.split("/").pop() } });
  // Step 1: open the resumable session
  const startRes = await fetch(`https://generativelanguage.googleapis.com/upload/v1beta/files`, {
    method: "POST",
    headers: {
      "x-goog-api-key": key,
      "X-Goog-Upload-Protocol": "resumable",
      "X-Goog-Upload-Command": "start",
      "X-Goog-Upload-Header-Content-Length": String(size),
      "X-Goog-Upload-Header-Content-Type": "video/mp4",
      "X-Goog-Upload-File-Name": file.split("/").pop() || "video.mp4",
      "Content-Type": "application/json",
    },
    body: meta,
  });
  if (!startRes.ok) throw new Error(`files start ${startRes.status}: ${await startRes.text()}`);
  const uploadUrl = startRes.headers.get("x-goog-upload-url");
  if (!uploadUrl) throw new Error("no upload url in files start response");

  // Step 2: stream the bytes
  const buf = fs.readFileSync(file);
  const upRes = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      "Content-Length": String(size),
      "X-Goog-Upload-Offset": "0",
      "X-Goog-Upload-Command": "upload, finalize",
      "Content-Type": "video/mp4",
    },
    body: new Uint8Array(buf),
  });
  if (!upRes.ok) throw new Error(`files upload ${upRes.status}: ${(await upRes.text()).slice(0, 300)}`);
  const j: any = await upRes.json();
  return j.file.uri;
}

async function waitForActive(uri: string, key: string): Promise<void> {
  const name = uri.split("/").slice(-2).join("/");
  for (let i = 0; i < 60; i++) {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/${name}`, { headers: { "x-goog-api-key": key } });
    if (res.ok) {
      const j: any = await res.json();
      if (j.state === "ACTIVE") return;
      if (j.state === "FAILED") throw new Error("gemini file processing failed");
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error("gemini file never became ACTIVE");
}

const SCHEMA = {
  type: "object",
  properties: {
    overall: { type: "string" },
    summary: { type: "string" },
    issues: {
      type: "array",
      items: {
        type: "object",
        properties: {
          timestamp: { type: "number" },
          severity: { type: "string", enum: ["info", "warning", "error"] },
          kind: { type: "string" },
          note: { type: "string" },
        },
        required: ["timestamp", "severity", "kind", "note"],
      },
    },
  },
  required: ["overall", "summary", "issues"],
};

export async function reviewVideo(file: string, programDuration: number, cutCount: number): Promise<ReviewReport> {
  const key = googleKey();
  const MODEL = preferences().geminiModel;
  if (!key) throw new Error("Add your Gemini API key in Settings → Connections.");

  // Choose transport
  let filePart: Record<string, unknown>;
  const size = fs.statSync(file).size;
  if (size <= 18 * 1024 * 1024) {
    const b64 = fs.readFileSync(file).toString("base64");
    filePart = { inline_data: { mime_type: "video/mp4", data: b64 } };
  } else {
    const uri = await filesApiUpload(file, key);
    await waitForActive(uri, key);
    filePart = { file_data: { mime_type: "video/mp4", file_uri: uri } };
  }

  const prompt = `You are reviewing a rendered video edit produced by a transcript-based video editor (like Descript). ${cutCount} cut${cutCount === 1 ? " was" : "s were"} made by deleting transcript words; the program is ${(programDuration / 60).toFixed(1)} minutes long.

Watch the ENTIRE video carefully, with audio. Report:
1. Hard problems: visible glitches, frozen frames, black frames, audio dropouts, pops/clicks at cut points, out-of-sync audio, abrupt jump cuts that look unintentional.
2. Editing quality: awkward mid-word cuts, dead air, pacing problems, sentences that now read as broken.
3. Anything where the cut clearly clipped a word's consonant/vowel.

Give exact timestamps (seconds into THIS rendered video) for every issue. Be precise and honest — no praise padding. If it's clean, say so plainly.`;

  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }, filePart] }],
      generationConfig: {
        temperature: 0.2,
        responseMimeType: "application/json",
        responseSchema: SCHEMA,
      },
    }),
  });
  if (!res.ok) throw new Error(`gemini ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const j: any = await res.json();
  const text = j.candidates?.[0]?.content?.parts?.map((p: any) => p.text || "").join("") || "";
  const parsed = JSON.parse(text);

  const issues: ReviewIssue[] = (parsed.issues || []).map((i: any) => ({
    timestamp: Number(i.timestamp) || 0,
    severity: (["info", "warning", "error"].includes(i.severity) ? i.severity : "info") as ReviewIssue["severity"],
    kind: String(i.kind || "general"),
    note: String(i.note || ""),
  }));

  return {
    model: MODEL,
    reviewedFile: file,
    summary: String(parsed.summary || ""),
    overall: String(parsed.overall || ""),
    issues,
    reviewedAt: new Date().toISOString(),
  };
}
