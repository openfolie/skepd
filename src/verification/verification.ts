import type { Task, Artifact } from "../domain/schemas.js";
import { execSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";

export interface VerificationResult {
  passed: boolean;
  reason: string;
  evidence: { check: string; passed: boolean; detail?: string }[];
}

export class VerificationService {
  verify(task: Task, artifacts: Artifact[], ctx: { workspacePath?: string; testCommand?: string | null; testRunLogPath?: string }): VerificationResult {
    const checks: { check: string; passed: boolean; detail?: string }[] = [];
    // artifact existence & hash
    for (const c of task.acceptanceCriteria) {
      if (c.type === "file_exists" && c.target) {
        const a = artifacts.find((x) => x.path === c.target || x.path.endsWith(c.target!));
        const ok = !!a;
        checks.push({ check: `file_exists:${c.target}`, passed: ok, detail: ok ? "found" : "missing" });
      } else if (c.type === "hash_match" && c.target) {
        const a = artifacts.find((x) => x.path === c.target);
        let ok = false;
        if (a && ctx.workspacePath) {
          try {
            const buf = readFileSync(join(ctx.workspacePath, a.path));
            const h = createHash("sha256").update(buf).digest("hex");
            ok = h === a.sha256;
          } catch { ok = false; }
        }
        checks.push({ check: `hash_match:${c.target}`, passed: ok });
      } else {
        checks.push({ check: `criterion:${c.id}`, passed: true, detail: "manual/assumed" });
      }
    }
    // test command
    if (ctx.testCommand) {
      let stdout = "";
      let stderr = "";
      let status: number | null = 0;
      let passed = true;
      try {
        const out = execSync(ctx.testCommand, { cwd: ctx.workspacePath, stdio: "pipe", timeout: 120000, encoding: "utf8" }) as string;
        stdout = out ?? "";
      } catch (e) {
        const err = e as { status?: number; stdout?: Buffer | string; stderr?: Buffer | string };
        passed = false;
        status = err.status ?? 1;
        stdout = typeof err.stdout === "string" ? err.stdout : err.stdout?.toString() ?? "";
        stderr = typeof err.stderr === "string" ? err.stderr : err.stderr?.toString() ?? "";
      }
      if (ctx.testRunLogPath) {
        const bounded = (s: string) => s.slice(0, 4000);
        const log = [`command: ${ctx.testCommand}`, `exit: ${passed ? 0 : status}`, "stdout:", bounded(stdout), "stderr:", bounded(stderr)].join("\n");
        writeFileSync(ctx.testRunLogPath, log);
      }
      checks.push({ check: "test_command", passed, detail: passed ? "exit 0" : `exit ${status}` });
    }
    const passed = checks.every((c) => c.passed);
    return { passed, reason: passed ? "all checks passed" : "one or more checks failed", evidence: checks };
  }
}