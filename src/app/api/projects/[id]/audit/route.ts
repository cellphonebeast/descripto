import { NextRequest, NextResponse } from "next/server";
import { loadProject, saveProject } from "@/lib/store";
import { auditTranscript } from "@/lib/anthropic";
import { markFillers } from "@/lib/edl";

export const runtime = "nodejs";
export const maxDuration = 300;

// POST /api/projects/:id/audit — Haiku audits the transcript
export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const p = loadProject(id);
  if (!p) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (!p.transcribed) return NextResponse.json({ error: "transcribe first" }, { status: 400 });
  try {
    markFillers(p.words);
    const engine = "whisper";
    const { corrections, notes, model } = await auditTranscript(p.words, engine);
    p.lastAudit = {
      model,
      corrections,
      notes,
      auditedAt: new Date().toISOString(),
    };
    saveProject(p);
    return NextResponse.json({ audit: p.lastAudit });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const p = loadProject(id);
  return NextResponse.json({ audit: p?.lastAudit || null });
}
