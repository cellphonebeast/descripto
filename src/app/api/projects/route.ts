import { createWriteStream } from "fs";
import fs from "fs";
import path from "path";
import { Readable } from "stream";
import { pipeline } from "stream/promises";
import { NextRequest, NextResponse } from "next/server";
import { listProjects, newId, projectDir, saveProject } from "@/lib/store";
import { probe } from "@/lib/ffmpeg";

export const runtime = "nodejs";
export const maxDuration = 3600;

// GET /api/projects — list all projects
export async function GET() {
  return NextResponse.json({ projects: listProjects() });
}

// POST /api/projects?name=<name> — create from an uploaded media file.
// The file is streamed raw from the request body straight to disk, so a
// multi-GB screen recording uploads with constant memory (no formData
// buffering, no 10x RAM amplification). The browser sends the File
// directly as the fetch body; curl can do --data-binary @file.
export async function POST(req: NextRequest) {
  try {
    const name = req.nextUrl.searchParams.get("name") || "Untitled";
    const id = newId();
    const dir = projectDir(id);
    fs.mkdirSync(dir, { recursive: true });

    const ext = path.extname(name) || ".mp4";
    const dest = path.join(dir, `source${ext}`);
    const tmp = dest + ".part";

    if (!req.body) {
      return NextResponse.json({ error: "missing file body" }, { status: 400 });
    }
    // stream request body -> disk
    await pipeline(Readable.fromWeb(req.body as any), createWriteStream(tmp));
    fs.renameSync(tmp, dest);

    const info = await probe(dest);
    if (!info.duration) {
      fs.rmSync(dir, { recursive: true, force: true });
      return NextResponse.json({ error: "could not read duration — is this a video/audio file?" }, { status: 400 });
    }

    const state = {
      id,
      name: name.replace(/\.[^.]+$/, ""),
      createdAt: new Date().toISOString(),
      sourceFile: dest,
      sourceDuration: info.duration,
      sourceWidth: info.width,
      sourceHeight: info.height,
      transcribed: false,
      words: [],
      paragraphs: [],
      studioSound: false,
    };
    saveProject(state);
    return NextResponse.json({ id });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
