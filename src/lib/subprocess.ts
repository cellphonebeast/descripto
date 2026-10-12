import { spawn } from "child_process";

// Wait for the actual child to close before resolving cancellation. Some ffmpeg
// filters take time to handle SIGTERM, so escalate instead of leaving an encoder.
export function runProcess(bin: string, args: string[], options: { signal?: AbortSignal; onStdout?: (chunk: string) => void } = {}): Promise<{ stdout: string; stderr: string }> {
  options.signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    let escalation: ReturnType<typeof setTimeout> | undefined;
    const abort = () => {
      child.kill("SIGTERM");
      escalation = setTimeout(() => child.kill("SIGKILL"), 1500);
      escalation.unref();
    };
    options.signal?.addEventListener("abort", abort, { once: true });
    if (options.signal?.aborted) abort();
    child.stdout.on("data", data => { const text = data.toString(); stdout = (stdout + text).slice(-1000000); options.onStdout?.(text); });
    child.stderr.on("data", data => { stderr = (stderr + data.toString()).slice(-4000); });
    const cleanup = () => { clearTimeout(escalation); options.signal?.removeEventListener("abort", abort); };
    child.once("error", error => { cleanup(); reject(error); });
    child.once("close", code => {
      cleanup();
      if (options.signal?.aborted) reject(options.signal.reason);
      else if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${bin} exited ${code}: ${stderr.slice(-2000)}`));
    });
  });
}
