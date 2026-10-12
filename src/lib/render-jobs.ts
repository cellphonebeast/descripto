import crypto from "crypto";
import type { RenderJob } from "./types";

type Task = { job: RenderJob; controller: AbortController; finished: Promise<void> };
const registry = globalThis as typeof globalThis & { __descriptoRenderTasks?: Map<string, Task> };
const tasks = registry.__descriptoRenderTasks ??= new Map<string, Task>();
export function activeRender(projectId: string) {
  return [...tasks.values()].find(t => t.job.projectId === projectId && ["running", "cancelling"].includes(t.job.status));
}
export function findRender(projectId: string, jobId: string) {
  const task = tasks.get(jobId);
  return task?.job.projectId === projectId ? task : undefined;
}
export function startRender(projectId: string, work: (job: RenderJob, signal: AbortSignal) => Promise<void>) {
  const active = activeRender(projectId);
  if (active) return active;
  const job: RenderJob = { id: `r${crypto.randomUUID()}`, projectId, status: "running", progress: 0, stage: "Preparing export", startedAt: Date.now() };
  const task: Task = { job, controller: new AbortController(), finished: Promise.resolve() };
  tasks.set(job.id, task);
  task.finished = Promise.resolve().then(() => work(job, task.controller.signal)).then(() => {
    task.controller.signal.throwIfAborted();
    job.status = "done"; job.progress = 100; job.stage = "Complete";
  }).catch(error => {
    job.status = task.controller.signal.aborted ? "cancelled" : "error";
    job.stage = job.status === "cancelled" ? "Export cancelled" : "Export failed";
    if (!task.controller.signal.aborted || error?.name !== "AbortError") job.error = error?.message || "Export failed";
  });
  // Bound completed history, without evicting a running job or its controller.
  if (tasks.size > 100) for (const [id, entry] of tasks) {
    if (!["running", "cancelling"].includes(entry.job.status)) tasks.delete(id);
    if (tasks.size <= 100) break;
  }
  return task;
}
export async function cancelRender(projectId: string, jobId: string) {
  const task = findRender(projectId, jobId);
  if (!task) return undefined;
  if (task.job.status === "running") {
    task.job.status = "cancelling"; task.job.stage = "Stopping export";
    task.controller.abort();
  }
  await task.finished;
  return task.job;
}
