import type { WorkerRunner, WorkerResult, WorkerContext } from "./worker.js";
import type { Task } from "../domain/schemas.js";
import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";

export class CodingWorker implements WorkerRunner {
  type = "coding";

  async execute(task: Task, ctx: WorkerContext): Promise<WorkerResult> {
    const commands = Array.isArray((task.metadata as Record<string, unknown>)?.commands)
      ? ((task.metadata as Record<string, unknown>).commands as string[])
      : [];
    let output = "";
    for (const cmd of commands) {
      output += `$ ${cmd}\n`;
      try {
        const out = execSync(cmd, { cwd: ctx.workspacePath, stdio: "pipe", timeout: 120000, encoding: "utf8" });
        output += out ?? "";
      } catch (e) {
        const err = e as { status?: number; stdout?: Buffer | string; stderr?: Buffer | string };
        output += (typeof err.stdout === "string" ? err.stdout : err.stdout?.toString() ?? "");
        output += (typeof err.stderr === "string" ? err.stderr : err.stderr?.toString() ?? "");
        throw new Error(`command failed: ${cmd} (exit ${err.status ?? "err"})`);
      }
    }
    writeFileSync(join(ctx.artifactsDir, "command-output.txt"), output);

    // produce patch.diff from worktree
    let diff = "";
    try {
      diff = execSync("git diff", { cwd: ctx.workspacePath, stdio: "pipe", encoding: "utf8" }) as string;
    } catch (e) {
      const err = e as { stdout?: Buffer | string };
      diff = typeof err.stdout === "string" ? err.stdout : err.stdout?.toString() ?? "";
    }
    if (!diff.trim()) {
      // include untracked? git diff --no-index not needed; attempt git diff HEAD
      try {
        diff = execSync("git diff HEAD", { cwd: ctx.workspacePath, stdio: "pipe", encoding: "utf8" }) as string;
      } catch (e) {
        const err = e as { stdout?: Buffer | string };
        diff = typeof err.stdout === "string" ? err.stdout : err.stdout?.toString() ?? "";
      }
    }
    writeFileSync(join(ctx.artifactsDir, "patch.diff"), diff);

    // report.md
    const report = `# Task ${task.id}\n\n${task.description}\n\nPatch: patch.diff\n`;
    writeFileSync(join(ctx.artifactsDir, "report.md"), report);

    const artifacts = ["patch.diff", "command-output.txt", "report.md"].map((name) => {
      const buf = readFileSync(join(ctx.artifactsDir, name));
      const hash = createHash("sha256").update(buf).digest("hex");
      return { artifactId: `${task.id}-${name}`, path: name, sha256: hash };
    });

    return {
      summary: `coding task completed: ${task.id}`,
      artifacts,
      evidence: [],
      attempt: task.attempt,
    };
  }

  async cancel(): Promise<void> {}
  async health(): Promise<{ available: boolean; activeTasks: number }> { return { available: true, activeTasks: 0 }; }
}