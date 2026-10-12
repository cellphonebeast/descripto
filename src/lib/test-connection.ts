import type { Provider } from "./settings";
export async function testConnection(provider: Provider, key: string) {
  if (!key) throw new Error("Add an API key first.");
  const endpoints = {
    gemini: "https://generativelanguage.googleapis.com/v1beta/models?pageSize=1",
    groq: "https://api.groq.com/openai/v1/models",
    anthropic: "https://api.anthropic.com/v1/models?limit=1",
    auphonic: "https://auphonic.com/api/user.json",
  };
  const headers: Record<string, string> = provider === "gemini" ? { "x-goog-api-key": key }
    : provider === "anthropic" ? { "x-api-key": key, "anthropic-version": "2023-06-01" }
    : { Authorization: `Bearer ${key}` };
  let res: Response;
  try { res = await fetch(endpoints[provider], { headers, signal: AbortSignal.timeout(12000), redirect: "error", cache: "no-store" }); }
  catch { throw new Error("Could not reach this service. Check your connection and try again."); }
  if (!res.ok) throw new Error(res.status === 401 || res.status === 403 ? "Key was not accepted. Check its value and permissions." : res.status === 429 ? "Service rate limit reached. Try again shortly." : `Service returned HTTP ${res.status}. Try again later.`);
  if (provider === "auphonic") {
    const body = await res.json();
    if (body.error_code || body.status_code !== 200) throw new Error("Auphonic did not accept this key.");
  }
  return "Key accepted. Usage limits and model access still depend on your account.";
}
