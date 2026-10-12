import { createReadStream, statSync } from "fs";
import fs from "fs";
import { Readable } from "stream";
import { NextRequest, NextResponse } from "next/server";
import { loadProject } from "@/lib/store";

export const runtime = "nodejs";

const CHUNK = 4 * 1024 * 1024;

// GET /api/projects/:id/media — serve the source video with Range support,
// streaming 4MB slices from disk (constant memory even for multi-GB files).
// ?render=1 serves the latest render instead.
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const p = loadProject(id);
  if (!p) return new NextResponse("not found", { status: 404 });

  const file = req.nextUrl.searchParams.get("render") ? p.lastRender?.file : p.sourceFile;
  if (!file || !fs.existsSync(file)) return new NextResponse("no file", { status: 404 });

  const stat = statSync(file);
  const type = file.endsWith(".mp4") ? "video/mp4" : "application/octet-stream";
  const range = req.headers.get("range");

  const streamRange = (start: number, end: number, status: number) => {
    const nodeStream = createReadStream(file, { start, end });
    const webStream = Readable.toWeb(nodeStream) as unknown as ReadableStream;
    return new NextResponse(webStream, {
      status,
      headers: {
        "Content-Range": `bytes ${start}-${end}/${stat.size}`,
        "Accept-Ranges": "bytes",
        "Content-Length": String(end - start + 1),
        "Content-Type": type,
      },
    });
  };

  if (range) {
    const m = range.match(/bytes=(\d+)-(\d*)/);
    if (m) {
      const start = parseInt(m[1], 10);
      const end = m[2] ? Math.min(parseInt(m[2], 10), stat.size - 1) : Math.min(start + CHUNK - 1, stat.size - 1);
      if (start >= stat.size) {
        return new NextResponse(null, {
          status: 416,
          headers: { "Content-Range": `bytes */${stat.size}` },
        });
      }
      return streamRange(start, end, 206);
    }
  }
  // no range: stream the whole file
  const nodeStream = createReadStream(file);
  const webStream = Readable.toWeb(nodeStream) as unknown as ReadableStream;
  return new NextResponse(webStream, {
    headers: { "Content-Type": type, "Accept-Ranges": "bytes", "Content-Length": String(stat.size) },
  });
}
