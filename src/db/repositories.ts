import { eq, and, or, isNull, lt, asc, sql } from "drizzle-orm";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { goals, tasks, events, artifacts, modelInvocations } from "./schema.js";
import type { Db } from "./client.js";
import type { Goal, Task, Event, Artifact, ModelInvocation } from "../domain/schemas.js";

function j(v: unknown): string { return JSON.stringify(v ?? null); }
function pj<T>(s: string | null): T { return JSON.parse(s ?? "null") as T; }

export class GoalRepo {
  constructor(private db: Db) {}
  create(g: Goal): void {
    this.db.insert(goals).values({
      id: g.id, spec: g.spec, successCriteria: j(g.successCriteria), budgetUsd: g.budgetUsd,
      deadlineSeconds: g.deadlineSeconds, allowedCapabilities: j(g.allowedCapabilities), status: g.status,
      currentPlanRevision: g.currentPlanRevision, repoPath: g.repoPath, testCommand: g.testCommand,
      createdAt: g.createdAt, updatedAt: g.updatedAt, completedAt: g.completedAt,
    }).run();
  }
  get(id: string): Goal | null {
    const r = this.db.select().from(goals).where(eq(goals.id, id)).get();
    if (!r) return null;
    return {
      id: r.id, spec: r.spec, successCriteria: pj(r.successCriteria), budgetUsd: r.budgetUsd,
      deadlineSeconds: r.deadlineSeconds, allowedCapabilities: pj(r.allowedCapabilities), status: r.status as Goal["status"],
      currentPlanRevision: r.currentPlanRevision, repoPath: r.repoPath, testCommand: r.testCommand,
      createdAt: r.createdAt, updatedAt: r.updatedAt, completedAt: r.completedAt,
    };
  }
  update(id: string, patch: Partial<Goal>): void {
    const sets: Record<string, unknown> = { updatedAt: new Date().toISOString() };
    if (patch.status !== undefined) sets.status = patch.status;
    if (patch.currentPlanRevision !== undefined) sets.currentPlanRevision = patch.currentPlanRevision;
    if (patch.completedAt !== undefined) sets.completedAt = patch.completedAt;
    if (patch.repoPath !== undefined) sets.repoPath = patch.repoPath;
    if (patch.testCommand !== undefined) sets.testCommand = patch.testCommand;
    if (patch.budgetUsd !== undefined) sets.budgetUsd = patch.budgetUsd;
    if (patch.deadlineSeconds !== undefined) sets.deadlineSeconds = patch.deadlineSeconds;
    this.db.update(goals).set(sets).where(eq(goals.id, id)).run();
  }
  listActive(): Goal[] {
    return this.db.select().from(goals).where(eq(goals.status, "active")).all().map((r) => this.get(r.id)!);
  }
}

export class TaskRepo {
  constructor(private db: Db) {}
  create(t: Task): void {
    this.db.insert(tasks).values({
      id: t.id, goalId: t.goalId, planRevision: t.planRevision, localKey: t.localKey, description: t.description,
      acceptanceCriteria: j(t.acceptanceCriteria), workerType: t.workerType, requiredCapabilities: j(t.requiredCapabilities),
      dependencies: j(t.dependencies), status: t.status, attempt: t.attempt, maxAttempts: t.maxAttempts,
      executionDeadline: t.executionDeadline, resourceBudgetUsd: t.resourceBudgetUsd, leaseOwner: t.leaseOwner,
      leaseExpiresAt: t.leaseExpiresAt, nextAttemptAt: t.nextAttemptAt, workspaceRef: t.workspaceRef,
      sessionId: t.sessionId, resultSummary: t.resultSummary, evidence: j(t.evidence), failureReason: t.failureReason,
      verificationVerdict: t.verificationVerdict ? j(t.verificationVerdict) : null, metadata: j(t.metadata),
      idempotencyKey: t.idempotencyKey, sideEffectClass: t.sideEffectClass, createdAt: t.createdAt, updatedAt: t.updatedAt,
    }).run();
  }
  get(id: string): Task | null {
    const r = this.db.select().from(tasks).where(eq(tasks.id, id)).get();
    if (!r) return null;
    return this.rowToTask(r);
  }
  private rowToTask(r: typeof tasks.$inferSelect): Task {
    return {
      id: r.id, goalId: r.goalId, planRevision: r.planRevision, localKey: r.localKey, description: r.description,
      acceptanceCriteria: pj(r.acceptanceCriteria), workerType: r.workerType, requiredCapabilities: pj(r.requiredCapabilities),
      dependencies: pj(r.dependencies), status: r.status as Task["status"], attempt: r.attempt, maxAttempts: r.maxAttempts,
      executionDeadline: r.executionDeadline, resourceBudgetUsd: r.resourceBudgetUsd, leaseOwner: r.leaseOwner,
      leaseExpiresAt: r.leaseExpiresAt, nextAttemptAt: r.nextAttemptAt, workspaceRef: r.workspaceRef, sessionId: r.sessionId,
      resultSummary: r.resultSummary, evidence: pj(r.evidence), failureReason: r.failureReason,
      verificationVerdict: r.verificationVerdict ? pj(r.verificationVerdict) : null, metadata: pj(r.metadata),
      idempotencyKey: r.idempotencyKey, sideEffectClass: r.sideEffectClass as Task["sideEffectClass"],
      createdAt: r.createdAt, updatedAt: r.updatedAt,
    };
  }
  listByGoal(goalId: string): Task[] {
    return this.db.select().from(tasks).where(eq(tasks.goalId, goalId)).all().map((r) => this.rowToTask(r));
  }
  listReady(nowIso: string): Task[] {
    return this.db.select().from(tasks).where(
      and(eq(tasks.status, "ready"), or(isNull(tasks.nextAttemptAt), lt(tasks.nextAttemptAt, nowIso)))
    ).all().map((r) => this.rowToTask(r));
  }
  update(id: string, patch: Partial<Task>): void {
    const sets: Record<string, unknown> = { updatedAt: new Date().toISOString() };
    const fields: (keyof Task)[] = ["status","attempt","leaseOwner","leaseExpiresAt","nextAttemptAt","workspaceRef",
      "sessionId","resultSummary","failureReason","idempotencyKey","sideEffectClass","executionDeadline","resourceBudgetUsd","maxAttempts"];
    for (const f of fields) {
      if (patch[f] !== undefined) {
        sets[f] = patch[f];
      }
    }
    if (patch.acceptanceCriteria !== undefined) sets.acceptanceCriteria = j(patch.acceptanceCriteria);
    if (patch.requiredCapabilities !== undefined) sets.requiredCapabilities = j(patch.requiredCapabilities);
    if (patch.dependencies !== undefined) sets.dependencies = j(patch.dependencies);
    if (patch.evidence !== undefined) sets.evidence = j(patch.evidence);
    if (patch.metadata !== undefined) sets.metadata = j(patch.metadata);
    if (patch.verificationVerdict !== undefined) sets.verificationVerdict = patch.verificationVerdict ? j(patch.verificationVerdict) : null;
    this.db.update(tasks).set(sets).where(eq(tasks.id, id)).run();
  }
  claimAtomic(taskId: string, runtimeInstanceId: string, leaseExpiresAt: string): boolean {
    const res = this.db.update(tasks).set({
      status: "executing", attempt: sql`attempt + 1`, leaseOwner: runtimeInstanceId, leaseExpiresAt,
      updatedAt: new Date().toISOString(),
    }).where(and(eq(tasks.id, taskId), eq(tasks.status, "ready"))).run();
    return res.changes > 0;
  }
}

export class EventRepo {
  constructor(private db: Db) {}
  nextSequence(goalId: string): number {
    const r = this.db.select({ m: sql<number>`COALESCE(MAX(sequence),0)` }).from(events).where(eq(events.goalId, goalId)).get();
    return (r?.m ?? 0) + 1;
  }
  append(e: Event): void {
    this.db.insert(events).values({
      goalId: e.goalId, sequence: e.sequence, type: e.type, taskId: e.taskId,
      payload: j(e.payload), traceId: e.traceId, createdAt: e.createdAt,
    }).run();
  }
  list(goalId: string, tail?: number): Event[] {
    const rows = this.db.select().from(events).where(eq(events.goalId, goalId)).orderBy(asc(events.sequence)).all();
    const sliced = tail ? rows.slice(-tail) : rows;
    return sliced.map((r) => ({
      id: r.id, goalId: r.goalId, sequence: r.sequence, type: r.type, taskId: r.taskId,
      payload: pj(r.payload), traceId: r.traceId, createdAt: r.createdAt,
    }));
  }
}

export class ArtifactRepo {
  constructor(private db: Db) {}
  create(a: Artifact): void {
    this.db.insert(artifacts).values({
      id: a.id, goalId: a.goalId, taskId: a.taskId, path: a.path, sha256: a.sha256,
      sizeBytes: a.sizeBytes, mediaType: a.mediaType, consumedArtifacts: j(a.consumedArtifacts), createdAt: a.createdAt,
    }).run();
  }
  listByTask(taskId: string): Artifact[] {
    return this.db.select().from(artifacts).where(eq(artifacts.taskId, taskId)).all().map((r) => ({
      id: r.id, goalId: r.goalId, taskId: r.taskId, path: r.path, sha256: r.sha256,
      sizeBytes: r.sizeBytes, mediaType: r.mediaType, consumedArtifacts: pj(r.consumedArtifacts), createdAt: r.createdAt,
    }));
  }
  listByGoal(goalId: string): Artifact[] {
    return this.db.select().from(artifacts).where(eq(artifacts.goalId, goalId)).all().map((r) => ({
      id: r.id, goalId: r.goalId, taskId: r.taskId, path: r.path, sha256: r.sha256,
      sizeBytes: r.sizeBytes, mediaType: r.mediaType, consumedArtifacts: pj(r.consumedArtifacts), createdAt: r.createdAt,
    }));
  }
  validateHash(artifact: Artifact, rootPath: string): boolean {
    try {
      const buf = readFileSync(join(rootPath, artifact.path));
      const hash = createHash("sha256").update(buf).digest("hex");
      return hash === artifact.sha256;
    } catch {
      return false;
    }
  }
}

export class ModelInvocationRepo {
  constructor(private db: Db) {}
  create(m: ModelInvocation): void {
    this.db.insert(modelInvocations).values({
      id: m.id, goalId: m.goalId, taskId: m.taskId, status: m.status, estimatedCostUsd: m.estimatedCostUsd,
      actualCostUsd: m.actualCostUsd, inputTokens: m.inputTokens, outputTokens: m.outputTokens,
      createdAt: m.createdAt, reconciledAt: m.reconciledAt, reconciliationOutcome: m.reconciliationOutcome,
    }).run();
  }
  get(id: string): ModelInvocation | null {
    const r = this.db.select().from(modelInvocations).where(eq(modelInvocations.id, id)).get();
    if (!r) return null;
    return {
      id: r.id, goalId: r.goalId, taskId: r.taskId, status: r.status as ModelInvocation["status"],
      estimatedCostUsd: r.estimatedCostUsd, actualCostUsd: r.actualCostUsd, inputTokens: r.inputTokens,
      outputTokens: r.outputTokens, createdAt: r.createdAt, reconciledAt: r.reconciledAt,
      reconciliationOutcome: r.reconciliationOutcome,
    };
  }
  update(id: string, patch: Partial<ModelInvocation>): void {
    const sets: Record<string, unknown> = {};
    if (patch.status !== undefined) sets.status = patch.status;
    if (patch.actualCostUsd !== undefined) sets.actual_cost_usd = patch.actualCostUsd;
    if (patch.inputTokens !== undefined) sets.input_tokens = patch.inputTokens;
    if (patch.outputTokens !== undefined) sets.output_tokens = patch.outputTokens;
    if (patch.reconciledAt !== undefined) sets.reconciled_at = patch.reconciledAt;
    if (patch.reconciliationOutcome !== undefined) sets.reconciliation_outcome = patch.reconciliationOutcome;
    this.db.update(modelInvocations).set(sets).where(eq(modelInvocations.id, id)).run();
  }
}