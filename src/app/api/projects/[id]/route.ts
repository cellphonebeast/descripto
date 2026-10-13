import fs from "fs";
import { NextRequest, NextResponse } from "next/server";
import { loadProject, saveProject, projectDir } from "@/lib/store";
import { computeCuts, programDuration } from "@/lib/edl";

import { applyEdits, type EditState } from "@/lib/edit-state";

export const runtime = "nodejs";

// GET /api/projects/:id — full state + derived cut math
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const p = loadProject(id);
  if (!p) return NextResponse.json({ error: "not found" }, { status: 404 });
  const cuts = computeCuts(p.words);
  return NextResponse.json({
    project: p,
    cuts,
    programDuration: programDuration(cuts, p.sourceDuration),
  });
}

interface Mutation {
  edit?: EditState;
  op: "setEditState" | "setDeleted" | "restore" | "restoreAll" | "deleteFillers" | "restoreFillers" | "applyCorrection" | "setStudioSound";
  wordIds?: string[];
  deleted?: boolean;
  studioSound?: boolean;
  correction?: { wordId: string; suggested: string };
}

// PUT /api/projects/:id — mutate editing state
export async function PUT(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const p = loadProject(id);
  if (!p) return NextResponse.json({ error: "not found" }, { status: 404 });
  const body = (await req.json()) as Mutation;
  const byId = new Map(p.words.map((w) => [w.id, w]));

  switch (body.op) {
    case "setEditState":
      try { applyEdits(p, body.edit); } catch (error) { return NextResponse.json({ error: (error as Error).message }, { status: 409 }); }
      break;
    case "setDeleted":
      for (const wid of body.wordIds || []) {
        const w = byId.get(wid);
        if (w) w.deleted = body.deleted ?? true;
      }
      break;
    case "restore":
      for (const wid of body.wordIds || []) {
        const w = byId.get(wid);
        if (w) w.deleted = false;
      }
      break;
    case "restoreAll":
      for (const w of p.words) w.deleted = false;
      break;
    case "deleteFillers":
      for (const w of p.words) if (w.filler) w.deleted = true;
      break;
    case "restoreFillers":
      for (const w of p.words) if (w.filler) w.deleted = false;
      break;
    case "applyCorrection": {
      const w = byId.get(body.correction?.wordId || "");
      if (w && body.correction) {
        w.text = body.correction.suggested;
        if (p.lastAudit) {
          for (const c of p.lastAudit.corrections) {
            if (c.wordId === w.id) c.applied = true;
          }
        }
      }
      break;
    }
    case "setStudioSound":
      p.studioSound = body.studioSound ?? false;
      break;
    default:
      return NextResponse.json({ error: "unknown op" }, { status: 400 });
  }

  saveProject(p);
  const cuts = computeCuts(p.words);
  return NextResponse.json({ ok: true, cuts, programDuration: programDuration(cuts, p.sourceDuration) });
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const p = loadProject(id);
  if (p) fs.rmSync(projectDir(id), { recursive: true, force: true });
  return NextResponse.json({ ok: true });
}
