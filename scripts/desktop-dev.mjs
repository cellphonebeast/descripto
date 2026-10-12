#!/usr/bin/env node
// Dev launcher: runs `next dev`, waits for it, then opens the Descripto
// Electron shell attached to the dev server. Kills both on exit.

import { spawn } from "node:child_process";
import http from "node:http";
import process from "node:process";

const PORT = 3000;
const BASE = `http://127.0.0.1:${PORT}`;

const next = spawn("npx", ["next", "dev", "-H", "127.0.0.1", "-p", String(PORT)], {
  cwd: process.cwd(),
  stdio: ["ignore", "pipe", "pipe"],
});
next.stdout.on("data", (d) => process.stdout.write(`[next] ${d}`));
next.stderr.on("data", (d) => process.stderr.write(`[next] ${d}`));

function waitFor(url, timeoutMs = 60000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const ping = () => {
      const req = http.get(url, (res) => {
        res.resume();
        resolve();
      });
      req.on("error", () => {
        if (Date.now() - started > timeoutMs) reject(new Error("next dev did not start"));
        else setTimeout(ping, 500);
      });
    };
    ping();
  });
}

try {
  await waitFor(BASE);
} catch (e) {
  console.error(e.message);
  next.kill("SIGTERM");
  process.exit(1);
}

const electron = spawn("npx", ["electron", "."], {
  cwd: process.cwd(),
  env: { ...process.env, DEV_SERVER_URL: BASE },
  stdio: "inherit",
});
electron.on("exit", (code) => {
  next.kill("SIGTERM");
  process.exit(code ?? 0);
});
next.on("exit", () => process.exit(0));
