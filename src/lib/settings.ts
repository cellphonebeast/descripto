import fs from "fs";
import os from "os";
import path from "path";
import crypto from "crypto";
import { z } from "zod";

export const providerSchema = z.enum(["gemini", "auphonic", "groq", "anthropic"]);
export type Provider = z.infer<typeof providerSchema>;
export const defaults = {
  audioProcessor: "local" as "local" | "auphonic",
  agentAuth: "signin" as "signin" | "key",
  geminiModel: "gemini-2.5-flash",
  auditModel: "claude-haiku-5-5",
  agentModel: "claude-sonnet-4-5",
};
const model = z.string().trim().min(1).max(100).regex(/^[a-zA-Z0-9._-]+$/);
export const preferencesSchema = z.object({
  audioProcessor: z.enum(["local", "auphonic"]).optional(),
  agentAuth: z.enum(["signin", "key"]).optional(),
  geminiModel: model.optional(), auditModel: model.optional(), agentModel: model.optional(),
}).strict();
const key = z.string().trim().min(1).max(4096).regex(/^[\x21-\x7e]+$/);
export const updateSchema = z.object({
  provider: providerSchema.optional(),
  action: z.enum(["save", "remove", "environment"]).optional(),
  key: key.optional(),
  preferences: preferencesSchema.optional(),
}).strict().refine(v => v.provider ? !!v.action && (v.action !== "save" || !!v.key) : !v.action && !v.key && !!v.preferences);
const diskSchema = z.object({ keys: z.partialRecord(providerSchema, z.string().nullable()).optional(), preferences: preferencesSchema.optional() });
type Settings = z.infer<typeof diskSchema>;
export function settingsPath() {
  const base = process.env.DESCRIPTO_CONFIG_DIR || (process.platform === "darwin"
    ? path.join(os.homedir(), "Library", "Application Support", "Descripto")
    : path.join(process.env.APPDATA || process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"), "Descripto"));
  return path.join(base, "connections.json");
}
export function readSettings(): Settings {
  try { return diskSchema.parse(JSON.parse(fs.readFileSync(settingsPath(), "utf8"))); }
  catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return {}; throw new Error("Could not read connection settings. Your saved settings have not been changed."); }
}
export function preferences() { return { ...defaults, ...readSettings().preferences }; }
export function updateSettings(input: unknown) {
  const update = updateSchema.parse(input);
  const data = readSettings();
  if (update.provider) {
    data.keys ||= {};
    if (update.action === "environment") delete data.keys[update.provider];
    else data.keys[update.provider] = update.action === "remove" ? null : update.key!;
  }
  data.preferences = { ...data.preferences, ...update.preferences };
  const file = settingsPath();
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${crypto.randomUUID()}.tmp`;
  try {
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600, flag: "wx" });
    fs.renameSync(tmp, file);
  } finally { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); }
}
