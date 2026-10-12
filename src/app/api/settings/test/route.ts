import { NextResponse } from "next/server";
import { z } from "zod";
import { providerSchema } from "@/lib/settings";
import { serviceKey } from "@/lib/env";
import { trustedSettingsRequest } from "@/lib/settings-http";
import { testConnection } from "@/lib/test-connection";
export const runtime = "nodejs";
const schema = z.object({ provider: providerSchema, key: z.string().trim().min(1).max(4096).regex(/^[\x21-\x7e]+$/).optional() }).strict();
export async function POST(req: Request) {
  const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
  if (!trustedSettingsRequest(req)) return reply({ error: "Local app access only." }, 403);
  const input = schema.safeParse(await req.json().catch(() => null));
  if (!input.success) return reply({ error: "Choose a service and enter a valid key." }, 400);
  try { return reply({ message: await testConnection(input.data.provider, input.data.key || serviceKey(input.data.provider)) }); }
  catch (e) { return reply({ error: (e as Error).message }, 400); }
}
