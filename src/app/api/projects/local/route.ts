import fs from "fs";
import path from "path";
import { NextRequest, NextResponse } from "next/server";
import { listProjects, newId, projectDir, saveProject } from "@/lib/store";
import { probe } from "@/lib/ffmpeg";

export const runtime = "nodejs";
export const maxDuration = 3600;

// POST /api/projects/local?path=<abs path to media file>
// Desktop flow: the file is already on this machine, so we clone it into the
// project folder (APFS clonefile = instant, no extra disk space on the same
// volume) instead of transferring bytes over HTTP. Falls back to a real copy
// across volumes.
export async function POST(req: NextRequest) {
  let createdDir: string | undefined;
  try {
    if (req.nextUrl.pathname === "/api/projects" && !req.body) return NextResponse.json({ error: "Choose a media file to import." }, { status: 400 });
    const src = req.nextUrl.searchParams.get("path") || "";
    const name = req.nextUrl.searchParams.get("name") || path.basename(src) || "Untitled";

    if (!src || !path.isAbsolute(src)) {
      return NextResponse.json({ error: "absolute path required" }, { status: 400 });
    }
    const stat = fs.statSync(src); // throws if missing
    if (!stat.isFile()) {
      return NextResponse.json({ error: "not a regular file" }, { status: 400 });
    }

    const id = newId();
    const dir = projectDir(id);
    createdDir = dir;
    fs.mkdirSync(dir, { recursive: true });

    const ext = path.extname(src) || ".mp4";
    const dest = path.join(dir, `source${ext}`);
    // best-effort APFS clone; real copy across volumes
    fs.copyFileSync(src, dest, fs.constants.COPYFILE_FICLONE);

    const info = await probe(dest);
    if (!info.duration) {
      fs.rmSync(dir, { recursive: true, force: true });
      return NextResponse.json(
        { error: "could not read duration — is this a video/audio file?" },
        { status: 400 },
      );
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
    if (createdDir) fs.rmSync(createdDir, { recursive: true, force: true });
    return NextResponse.json({ error: "Could not open this recording. Check that it is a valid video or audio file and try again." }, { status: 400 });
  }
}

// re-export list for convenience
export async function GET() {
  return NextResponse.json({ projects: listProjects() });
}
