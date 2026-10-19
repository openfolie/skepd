import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";

export class BudgetService {
  raw: Database.Database;
  config: unknown;

  constructor(arg1?: unknown, arg2?: unknown) {
    let raw: Database.Database | undefined;
    let config: unknown;
    if (arg1 && typeof arg1 === "object") {
      const o = arg1 as Record<string, unknown>;
      if ("raw" in o && o.raw) {
        raw = o.raw as Database.Database;
        config = o.config ?? arg2;
      } else if ("db" in o && o.db) {
        raw = o.db as Database.Database;
        config = o.config ?? arg2;
      } else if ("runtimeInstanceId" in o) {
        raw = (o as { raw: Database.Database }).raw;
        config = (o as { config: unknown }).config;
      }
    }
    if (!raw) {
      raw = arg1 as Database.Database;
      config = arg2;
    }
    this.raw = raw;
    this.config = config;
  }

  private limits(): Record<string, unknown> {
    const c = this.config as { limits?: Record<string, unknown> } | undefined;
    return c?.limits ?? {};
  }

  isExhausted(goalId: string): boolean {
    const limits = this.limits();
    if (limits.max_model_calls != null) {
      const row = this.raw.prepare("SELECT COUNT(*) as c FROM model_invocations WHERE goal_id = ?").get(goalId) as { c: number };
      if (row.c >= (limits.max_model_calls as number)) return true;
    }
    if (limits.max_estimated_cost_usd != null) {
      const row = this.raw.prepare("SELECT COALESCE(SUM(estimated_cost_usd),0) as s FROM model_invocations WHERE goal_id = ?").get(goalId) as { s: number };
      if (row.s >= (limits.max_estimated_cost_usd as number)) return true;
    }
    const goal = this.raw.prepare("SELECT budget_usd FROM goals WHERE id = ?").get(goalId) as { budget_usd: number | null } | undefined;
    if (goal?.budget_usd != null) {
      const row = this.raw.prepare("SELECT COALESCE(SUM(COALESCE(actual_cost_usd, estimated_cost_usd)),0) as s FROM model_invocations WHERE goal_id = ?").get(goalId) as { s: number };
      if (row.s >= goal.budget_usd) return true;
    }
    return false;
  }

  reserve(goalId: string, taskId: string | null, estimatedCost: number): string {
    if (this.isExhausted(goalId)) throw new Error("budget exhausted");
    const ct = this.limits().max_cost_per_task_usd;
    if (ct != null && estimatedCost > (ct as number)) throw new Error("per-task budget exceeded");
    const id = randomUUID();
    const now = new Date().toISOString();
    this.raw.prepare("INSERT INTO model_invocations (id, goal_id, task_id, status, estimated_cost_usd, actual_cost_usd, input_tokens, output_tokens, created_at, reconciled_at, reconciliation_outcome) VALUES (?, ?, ?, 'reserved', ?, NULL, NULL, NULL, ?, NULL, NULL)")
      .run(id, goalId, taskId, estimatedCost, now);
    return id;
  }

  reconcile(invocationId: string, actualCost: number, tokens: unknown): void {
    const now = new Date().toISOString();
    let inputTokens: number | null = null;
    let outputTokens: number | null = null;
    if (typeof tokens === "number") {
      inputTokens = tokens;
    } else if (tokens && typeof tokens === "object") {
      const t = tokens as Record<string, unknown>;
      if (typeof t.inputTokens === "number") inputTokens = t.inputTokens;
      if (typeof t.outputTokens === "number") outputTokens = t.outputTokens;
      if (typeof t.input_tokens === "number") inputTokens = t.input_tokens;
      if (typeof t.output_tokens === "number") outputTokens = t.output_tokens;
    }
    this.raw.prepare("UPDATE model_invocations SET status = 'completed', actual_cost_usd = ?, input_tokens = ?, output_tokens = ?, reconciled_at = ? WHERE id = ?")
      .run(actualCost, inputTokens, outputTokens, now, invocationId);
  }
}