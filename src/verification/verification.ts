import type { Task, Artifact } from "../domain/schemas.js";
import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";

export interface VerificationResult {
  passed: boolean;
  reason: string;
  evidence: { check: string; passed: boolean; detail?: string }[];
}

export class VerificationService {
  verify(task: Task, artifacts: Artifact[], ctx: { workspacePath?: string; testCommand?: string | null }): VerificationResult {
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
      try {
        execSync(ctx.testCommand, { cwd: ctx.workspacePath, stdio: "pipe", timeout: 120000 });
        checks.push({ check: "test_command", passed: true, detail: "exit 0" });
      } catch (e) {
        const err = e as { status?: number; stdout?: Buffer; stderr?: Buffer };
        checks.push({ check: "test_command", passed: false, detail: `exit ${err.status ?? "err"}` });
      }
    }
    const passed = checks.every((c) => c.passed);
    return { passed, reason: passed ? "all checks passed" : "one or more checks failed", evidence: checks };
  }
}