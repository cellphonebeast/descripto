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
  const download = req.nextUrl.searchParams.has("download");
  const headers: Record<string, string> = { "Content-Type": type, "Accept-Ranges": "bytes" };
  if (download) headers["Content-Disposition"] = `attachment; filename="descripto-export.mp4"; filename*=UTF-8''${encodeURIComponent(p.name + ".mp4").replace(/['()*]/g, c => "%" + c.charCodeAt(0).toString(16))}`;

  const streamRange = (start: number, end: number, status: number) => {
    const nodeStream = createReadStream(file, { start, end });
    const webStream = Readable.toWeb(nodeStream) as unknown as ReadableStream;
    return new NextResponse(webStream, {
      status,
      headers: {
        ...headers,
        "Content-Range": `bytes ${start}-${end}/${stat.size}`,
        "Accept-Ranges": "bytes",
        "Content-Length": String(end - start + 1),
        "Content-Type": type,
      },
    });
  };

  if (range) {
    const m = range.match(/^bytes=(\d*)-(\d*)$/);
    if (!m || (!m[1] && !m[2]) || !stat.size) return new NextResponse(null, { status: 416, headers: { "Content-Range": `bytes */${stat.size}` } });
    const start = m[1] ? Number(m[1]) : Math.max(0, stat.size - Number(m[2]));
    const end = m[1] ? (m[2] ? Math.min(Number(m[2]), stat.size - 1) : Math.min(start + CHUNK - 1, stat.size - 1)) : stat.size - 1;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= stat.size || end < start) return new NextResponse(null, { status: 416, headers: { "Content-Range": `bytes */${stat.size}` } });
    return streamRange(start, end, 206);
  }
  // no range: stream the whole file
  const nodeStream = createReadStream(file);
  const webStream = Readable.toWeb(nodeStream) as unknown as ReadableStream;
  return new NextResponse(webStream, {
    headers: { ...headers, "Content-Length": String(stat.size) },
  });
}
