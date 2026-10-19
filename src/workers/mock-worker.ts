import type { WorkerRunner, WorkerResult, WorkerContext } from "./worker.js";
import type { Task } from "../domain/schemas.js";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";

export class MockWorker implements WorkerRunner {
  type = "mock";
  private pending = new Map<string, (reason?: unknown) => void>();
  async execute(task: Task, ctx: WorkerContext): Promise<WorkerResult> {
    const behavior = (task.metadata as Record<string, unknown>)?.mockBehavior as string | undefined;
    if (behavior === "fail") throw new Error("mock failure");
    if (behavior === "hang" || behavior === "timeout") {
      const { promise, resolve, reject } = Promise.withResolvers<void>();
      this.pending.set(task.id, reject);
      try {
        await promise;
      } finally {
        this.pending.delete(task.id);
      }
      throw new Error("cancelled");
    }
    const dir = ctx.artifactsDir;
    mkdirSync(dir, { recursive: true });
    const name = "result.txt";
    const content = `mock result for ${task.id}`;
    writeFileSync(join(dir, name), content);
    const hash = createHash("sha256").update(content).digest("hex");
    return {
      summary: content,
      artifacts: [{ artifactId: `${task.id}-${name}`, path: name, sha256: hash }],
      evidence: [],
      attempt: task.attempt,
    };
  }
  async cancel(taskId: string): Promise<void> {
    const reject = this.pending.get(taskId);
    if (reject) reject(new Error("cancelled"));
  }
  async health(): Promise<{ available: boolean; activeTasks: number }> { return { available: true, activeTasks: this.pending.size }; }
}