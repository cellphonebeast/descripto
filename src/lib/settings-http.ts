// Credentials are managed only by the local, same-origin app.
export function trustedSettingsRequest(req: Request) {
  const host = req.headers.get("host") || new URL(req.url).host;
  if (!/^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(host)) return false;
  const origin = req.headers.get("origin");
  if (origin && origin !== `http://${host}`) return false;
  const site = req.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") return false;
  return req.method === "GET" || (!!origin && req.headers.get("content-type")?.startsWith("application/json"));
}
