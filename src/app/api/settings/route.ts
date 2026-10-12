import { NextResponse } from "next/server";
import { connectionStatus } from "@/lib/env";
import { preferences, updateSchema, updateSettings } from "@/lib/settings";
import { trustedSettingsRequest } from "@/lib/settings-http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
export async function GET(req: Request) {
  if (!trustedSettingsRequest(req)) return reply({ error: "Local app access only." }, 403);
  try { return reply({ connections: connectionStatus(), preferences: preferences() }); }
  catch { return reply({ error: "Could not read saved settings." }, 500); }
}
export async function PATCH(req: Request) {
  if (!trustedSettingsRequest(req)) return reply({ error: "Local app access only." }, 403);
  try {
    const parsed = updateSchema.safeParse(await req.json());
    if (!parsed.success) return reply({ error: "Check your key and model names, then try again." }, 400);
    updateSettings(parsed.data);
    return GET(req);
  } catch { return reply({ error: "Could not save settings. Your previous settings are unchanged." }, 500); }
}
