import { readSettings, type Provider } from "./settings";
import fs from "fs";
import os from "os";
import path from "path";

// Optional legacy fallback; prefer Settings → Connections or process env.
// Connection settings and environment files must never be committed.

let cached: Record<string, string> | null = null;

export function envFile(): Record<string, string> {
  if (cached) return cached;
  const out: Record<string, string> = {};
  try {
    const raw = fs.readFileSync(path.join(os.homedir(), ".env"), "utf-8");
    for (const line of raw.split("\n")) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m) out[m[1]] = m[2].trim();
    }
  } catch {
    // no ~/.env — fall back to process env only
  }
  cached = { ...out, ...pickSet(process.env) };
  return cached;
}

function pickSet(env: NodeJS.ProcessEnv): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of Object.keys(env)) {
    const v = env[k];
    if (typeof v === "string" && v.length > 0) out[k] = v;
  }
  return out;
}

export function needKey(name: string): string {
  const v = envFile()[name];
  if (!v) throw new Error(`Missing ${name} in ~/.env or environment`);
  return v;
}

const names: Record<Provider, string[]> = {
  gemini: ["GOOGLE_API_KEY", "GEMINI_API_KEY"], auphonic: ["AUPHONIC_API_KEY"],
  groq: ["GROQ_API_KEY"], anthropic: ["ANTHROPIC_API_KEY_CONTENT_ENGINE", "ANTHROPIC_API_KEY"],
};
export function serviceKey(provider: Provider): string {
  const saved = readSettings().keys?.[provider];
  if (saved !== undefined) return saved || "";
  const env = envFile();
  return names[provider].map(name => env[name]).find(Boolean) || "";
}
export function connectionStatus() {
  const saved = readSettings().keys || {};
  return Object.fromEntries(Object.keys(names).map(name => {
    const provider = name as Provider;
    return [provider, { configured: !!serviceKey(provider), source: saved[provider] === null ? "disabled" : saved[provider] ? "saved" : serviceKey(provider) ? "environment" : "none" }];
  }));
}
export function anthropicKey() { return serviceKey("anthropic"); }
export function anthropicBaseUrl() {
  // User-supplied keys are sent only to Anthropic, never a legacy proxy.
  return readSettings().keys?.anthropic ? "https://api.anthropic.com" : envFile()["ANTHROPIC_BASE_URL"] || "https://api.anthropic.com";
}
export function googleKey() { return serviceKey("gemini"); }
export function groqKey() { return serviceKey("groq"); }
