import { execFileSync } from "node:child_process";
import type Database from "better-sqlite3";
import type { Db } from "../db/client.js";
import { randomUUID } from "node:crypto";
import { TaskStatus, GoalStatus } from "../domain/enums.js";
import type { Task, Goal, Artifact } from "../domain/schemas.js";
import type { Config } from "../config/config.js";
import { openDb, runMigrations } from "../db/client.js";
import { getTraceId, withSpan } from "../observability/tracing.js";
import { GoalRepo, TaskRepo, EventRepo, ArtifactRepo } from "../db/repositories.js";
import type { WorkerRunner, WorkerResult, WorkerContext } from "../workers/worker.js";
import { VerificationService } from "../verification/verification.js";
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { BudgetService } from "../budget/budget.js";
import { createHash } from "node:crypto";
export interface SchedulerDeps {
  dbPath: string;
  migrationsDir: string;
  config: Config;
  artifactsRoot: string;
}

export interface PlanTaskInput {
  localKey: string;
  description: string;
  acceptanceCriteria: Task["acceptanceCriteria"];
  workerType: string;
  requiredCapabilities?: string[];
  dependencies?: string[]; // localKeys
  sideEffectClass?: Task["sideEffectClass"];
  metadata?: Record<string, unknown>;
  maxAttempts?: number;
}
export class SchedulerService {
  runtimeInstanceId: string;
  raw: Database.Database;
  db: Db;
  config: Config;
  goals: GoalRepo;
  tasks: TaskRepo;
  events: EventRepo;
  artifacts: ArtifactRepo;
  artifactsRoot: string;
  workers = new Map<string, WorkerRunner>();
  verifier = new VerificationService();
  budget!: BudgetService;
  active = new Set<string>();
  constructor(deps: SchedulerDeps) {
    this.config = deps.config;
    const r = this.config.runtime ?? {};
    const heartbeat = r.heartbeat_seconds ?? 30;
    const lease = r.lease_seconds ?? 120;
    if (!(heartbeat > 0) || !(lease > 0) || heartbeat >= lease) {
      throw new Error("heartbeat_seconds must be positive and less than lease_seconds");
    }
    const mc = r.max_concurrent_tasks ?? 3;
    const mt = r.max_tasks_per_goal ?? 40;
    const md = r.max_delegation_depth ?? 4;
    const wt = r.worker_timeout_seconds ?? 1;
    const ma = r.max_attempts ?? 3;
    if (!(mc > 0) || !(mt > 0) || !(md > 0) || !(wt > 0) || !(ma > 0)) {
      throw new Error("runtime values must be positive");
    }
    const l = this.config.limits ?? {};
    const gd = l.max_goal_duration_seconds ?? 3600;
    const mmc = l.max_model_calls ?? 150;
    const ce = l.max_estimated_cost_usd;
    const ct = l.max_cost_per_task_usd;
    if (gd !== null && gd <= 0) throw new Error("max_goal_duration_seconds must be positive or null");
    if (mmc !== null && mmc <= 0) throw new Error("max_model_calls must be positive or null");
    if (ce !== null && ce !== undefined && ce < 0) throw new Error("max_estimated_cost_usd must be non-negative or null");
    if (ct !== null && ct !== undefined && ct < 0) throw new Error("max_cost_per_task_usd must be non-negative or null");
    this.artifactsRoot = deps.artifactsRoot.startsWith("/") ? deps.artifactsRoot : join(process.cwd(), deps.artifactsRoot);
    const { raw, db } = openDb(deps.dbPath);
    this.raw = raw;
    this.db = db;
    runMigrations(raw, deps.migrationsDir);
    this.goals = new GoalRepo(db);
    this.tasks = new TaskRepo(db);
    this.events = new EventRepo(db);
    this.artifacts = new ArtifactRepo(db);
    this.budget = new BudgetService(this);
    this.runtimeInstanceId = randomUUID();
    this.revokeStaleLeases();
  }
  revokeStaleLeases(): void {

    const stale = this.raw.prepare("SELECT id, goal_id, status, workspace_ref FROM tasks WHERE lease_owner IS NOT NULL AND lease_owner != ?").all(this.runtimeInstanceId) as { id: string; goal_id: string; status: string; workspace_ref: string | null }[];
    const staleGoalIds = new Set(stale.map((r) => r.goal_id));
    // reset workspaces for recovered executing tasks
    for (const r of stale) {
      if (r.status !== "executing") continue;
      const ws = r.workspace_ref;
      if (ws) {
        try { rmSync(ws, { recursive: true, force: true }); } catch { /* ignore */ }
      }
      const goal = this.goals.get(r.goal_id);
      if (goal?.repoPath && this.isGitRepo(goal.repoPath)) {
        const base = this.baseCommit(goal.repoPath);
        const target = ws || join(this.artifactsRoot, "..", "workspaces", goal.id, r.id);
        try { execFileSync("git", ["worktree", "remove", "--force", target], { cwd: goal.repoPath, stdio: ["ignore", "pipe", "pipe"] }); } catch { /* ignore */ }
        try { rmSync(target, { recursive: true, force: true }); } catch { /* ignore */ }
        try { mkdirSync(target, { recursive: true }); execFileSync("git", ["worktree", "add", "--detach", target, base], { cwd: goal.repoPath, stdio: ["ignore", "pipe", "pipe"] }); } catch { /* ignore */ }
      }
    }
    this.raw.prepare("UPDATE tasks SET status='ready', lease_owner=NULL, lease_expires_at=NULL WHERE lease_owner IS NOT NULL AND lease_owner != ? AND status='executing'").run(this.runtimeInstanceId);
    this.raw.prepare("UPDATE tasks SET status='ready', lease_owner=NULL, lease_expires_at=NULL WHERE lease_owner IS NOT NULL AND lease_owner != ? AND status='verifying'").run(this.runtimeInstanceId);
    // mark uncertain model invocations for stale goals
    if (staleGoalIds.size > 0) {
      const ids = [...staleGoalIds];
      const placeholders = ids.map(() => "?").join(",");
      this.raw.prepare(`UPDATE model_invocations SET status='uncertain' WHERE status='reserved' AND goal_id IN (${placeholders})`).run(...ids);
    }
  }
  workerTimeoutMs(): number {
    const raw = this.config.runtime.worker_timeout_seconds;
    return Math.max(100, (raw ?? 1) * 1000);
  }
  baseCommit(repoPath: string): string {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: repoPath, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  }
  isGitRepo(repoPath: string): boolean {
    try { execFileSync("git", ["rev-parse", "--is-inside-work-tree"], { cwd: repoPath, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }); return true; } catch { return false; }
  }
  prepareWorkspace(task: Task, goal: Goal): string {
    const ws = join(this.artifactsRoot, "..", "workspaces", goal.id, task.id);
    if (goal.repoPath && this.isGitRepo(goal.repoPath)) {
      const base = this.baseCommit(goal.repoPath);
      try { execFileSync("git", ["worktree", "remove", "--force", ws], { cwd: goal.repoPath, stdio: ["ignore", "pipe", "pipe"] }); } catch { /* ignore */ }
      rmSync(ws, { recursive: true, force: true });
      execFileSync("git", ["worktree", "add", "--detach", ws, base], { cwd: goal.repoPath, stdio: ["ignore", "pipe", "pipe"] });
      return ws;
    }
    mkdirSync(ws, { recursive: true });
    return ws;
  }
  prepareVerificationWorkspace(task: Task, goal: Goal, patchPath?: string): string {
    if (!goal.repoPath || !this.isGitRepo(goal.repoPath)) return join(this.artifactsRoot, "..", "workspaces", goal.id, task.id);
    const ws = join(this.artifactsRoot, "..", "workspaces", goal.id, `${task.id}-verify`);
    const base = this.baseCommit(goal.repoPath);
    try { execFileSync("git", ["worktree", "remove", "--force", ws], { cwd: goal.repoPath, stdio: ["ignore", "pipe", "pipe"] }); } catch { /* ignore */ }
    rmSync(ws, { recursive: true, force: true });
    execFileSync("git", ["worktree", "add", "--detach", ws, base], { cwd: goal.repoPath, stdio: ["ignore", "pipe", "pipe"] });
    if (patchPath && existsSync(patchPath)) {
      execFileSync("git", ["apply", patchPath], { cwd: ws, stdio: ["ignore", "pipe", "pipe"] });
    }
    return ws;
  }

  registerWorker(w: WorkerRunner): void { this.workers.set(w.type, w); }

  logEvent(goalId: string, type: string, taskId?: string, payload: Record<string, unknown> = {}): void {
    const txn = this.raw.transaction(() => {
      const seq = this.events.nextSequence(goalId);
      this.events.append({
        id: undefined, goalId, sequence: seq, type, taskId: taskId ?? null, payload,
        traceId: getTraceId(), createdAt: new Date().toISOString(),
      });
    });
    txn();
  }

  createGoal(spec: string, opts: { repoPath?: string; testCommand?: string; budgetUsd?: number | null; deadlineSeconds?: number | null } = {}): Goal {
    if (opts.repoPath) {
      if (!existsSync(opts.repoPath)) throw new Error("repoPath does not exist: " + opts.repoPath);
      if (!this.isGitRepo(opts.repoPath)) throw new Error("repoPath is not a git repo: " + opts.repoPath);
    }
    const now = new Date().toISOString();
    const g: Goal = {
      id: randomUUID(), spec, successCriteria: [], budgetUsd: opts.budgetUsd ?? null,
      deadlineSeconds: opts.deadlineSeconds ?? null, allowedCapabilities: [], status: "active",
      currentPlanRevision: 0, repoPath: opts.repoPath ?? null, testCommand: opts.testCommand ?? null,
      createdAt: now, updatedAt: now, completedAt: null,
    };
    this.goals.create(g);
    this.logEvent(g.id, "goal.created", undefined, { spec });
    return g;
  }

  acceptPlan(goalId: string, revision: number, planTasks: PlanTaskInput[]): Task[] {
    const goal = this.goals.get(goalId)!;
    // cycle detection + validation
    const localKeys = new Set(planTasks.map((t) => t.localKey));
    if (localKeys.size !== planTasks.length) throw new Error("duplicate localKey");
    // validate deps exist
    for (const t of planTasks) {
      for (const d of t.dependencies ?? []) {
        if (!localKeys.has(d)) throw new Error(`unknown dependency ${d}`);
      }
    }
    // cycle detection
    const visited = new Set<string>(), stack = new Set<string>();
    const adj = new Map(planTasks.map((t) => [t.localKey, t.dependencies ?? []]));
    const dfs = (k: string): boolean => {
      if (stack.has(k)) return true;
      if (visited.has(k)) return false;
      visited.add(k); stack.add(k);
      for (const d of adj.get(k) ?? []) if (dfs(d)) return true;
      stack.delete(k);
      return false;
    };
    for (const t of planTasks) if (dfs(t.localKey)) throw new Error("cycle detected");
    if (planTasks.length > this.config.runtime.max_tasks_per_goal) throw new Error("too many tasks");
    for (const t of planTasks) {
      if (!this.workers.has(t.workerType)) throw new Error("unknown worker type: " + t.workerType);
    }
    const now = new Date().toISOString();
    const idByKey = new Map<string, string>();
    const created: Task[] = [];
    // two pass: create ids
    for (const t of planTasks) {
      const id = randomUUID();
      idByKey.set(t.localKey, id);
    }
    for (const t of planTasks) {
      const id = idByKey.get(t.localKey)!;
      const deps = (t.dependencies ?? []).map((k) => idByKey.get(k)!);
      const task: Task = {
        id, goalId, planRevision: revision, localKey: t.localKey, description: t.description,
        acceptanceCriteria: t.acceptanceCriteria, workerType: t.workerType,
        requiredCapabilities: t.requiredCapabilities ?? [], dependencies: deps, status: "pending",
        attempt: 0, maxAttempts: t.maxAttempts ?? this.config.runtime.max_attempts,
        executionDeadline: null, resourceBudgetUsd: null, leaseOwner: null, leaseExpiresAt: null,
        nextAttemptAt: null, workspaceRef: null, sessionId: null, resultSummary: null, evidence: [],
        failureReason: null, verificationVerdict: null, metadata: t.metadata ?? {},
        idempotencyKey: null, sideEffectClass: t.sideEffectClass ?? "none", createdAt: now, updatedAt: now,
      };
      this.tasks.create(task);
      created.push(task);
    }
    // promote initial ready
    this.promoteReady(goalId, revision);
    this.logEvent(goalId, "plan.accepted", undefined, { revision, taskCount: planTasks.length });
    return created;
  }
  replan(goalId: string, newPlanTasks: PlanTaskInput[]): Task[] {
    const goal = this.goals.get(goalId);
    if (!goal) throw new Error("goal not found");
    // max 1 replan
    const countRow = this.raw.prepare("SELECT COUNT(*) as c FROM events WHERE goal_id = ? AND type = 'replan.accepted'").get(goalId) as { c: number };
    const acceptedCount = countRow.c;
    if (acceptedCount >= 1 || goal.currentPlanRevision >= 1) throw new Error("max replan exceeded");
    // validation
    try {
      const localKeys = new Set(newPlanTasks.map((t) => t.localKey));
      if (localKeys.size !== newPlanTasks.length) throw new Error("duplicate localKey");
      // existing succeeded task ids for cross-plan deps
      const existingTasks = this.tasks.listByGoal(goalId);
      const succeededIds = new Set(existingTasks.filter((t) => t.status === TaskStatus.SUCCEEDED).map((t) => t.id));
      for (const t of newPlanTasks) {
        for (const d of t.dependencies ?? []) {
          if (!localKeys.has(d) && !succeededIds.has(d)) throw new Error(`unknown dependency ${d}`);
        }
      }
      // cycle detection among new tasks (internal deps only)
      const adj = new Map(newPlanTasks.map((t) => [t.localKey, (t.dependencies ?? []).filter((d) => localKeys.has(d))]));
      const visited = new Set<string>(), stack = new Set<string>();
      const dfs = (k: string): boolean => {
        if (stack.has(k)) return true;
        if (visited.has(k)) return false;
        visited.add(k); stack.add(k);
        for (const d of adj.get(k) ?? []) if (dfs(d)) return true;
        stack.delete(k);
        return false;
      };
      for (const t of newPlanTasks) if (dfs(t.localKey)) throw new Error("cycle detected");
      if (newPlanTasks.length > this.config.runtime.max_tasks_per_goal) throw new Error("too many tasks");
      for (const t of newPlanTasks) {
        if (!this.workers.has(t.workerType)) throw new Error("unknown worker type: " + t.workerType);
      }
    } catch (e) {
      const err = e as Error;
      this.logEvent(goalId, "replan.rejected", undefined, { reason: err.message });
      throw e;
      // deduped
    }
    // mutation in transaction
    const currentRevision = goal.currentPlanRevision;
    const newRevision = currentRevision + 1;
    const now = new Date().toISOString();
    const idByKey = new Map<string, string>();
    for (const t of newPlanTasks) idByKey.set(t.localKey, randomUUID());
    const created: Task[] = [];
    const txn = this.raw.transaction(() => {
      // supersede unfinished tasks in current revision
      for (const t of this.tasks.listByGoal(goalId)) {
        if (t.planRevision !== currentRevision) continue;
        if (t.status === TaskStatus.SUCCEEDED || t.status === TaskStatus.FAILED || t.status === TaskStatus.CANCELLED || t.status === TaskStatus.SUPERSEDED) continue;
        this.tasks.update(t.id, { status: TaskStatus.SUPERSEDED });
      }
      // update goal revision
      this.goals.update(goalId, { currentPlanRevision: newRevision, updatedAt: now });
      // insert new tasks
      const existingTasks = this.tasks.listByGoal(goalId);
      const succeededIds = new Set(existingTasks.filter((t) => t.status === TaskStatus.SUCCEEDED).map((t) => t.id));
      for (const t of newPlanTasks) {
        const id = idByKey.get(t.localKey)!;
        const deps = (t.dependencies ?? []).map((d) => (idByKey.has(d) ? idByKey.get(d)! : d));
        const task: Task = {
          id, goalId, planRevision: newRevision, localKey: t.localKey, description: t.description,
          acceptanceCriteria: t.acceptanceCriteria, workerType: t.workerType,
          requiredCapabilities: t.requiredCapabilities ?? [], dependencies: deps, status: "pending",
          attempt: 0, maxAttempts: t.maxAttempts ?? this.config.runtime.max_attempts,
          executionDeadline: null, resourceBudgetUsd: null, leaseOwner: null, leaseExpiresAt: null,
          nextAttemptAt: null, workspaceRef: null, sessionId: null, resultSummary: null, evidence: [],
          failureReason: null, verificationVerdict: null, metadata: t.metadata ?? {},
          idempotencyKey: null, sideEffectClass: t.sideEffectClass ?? "none", createdAt: now, updatedAt: now,
        };
        this.tasks.create(task);
        created.push(task);
      }
    });
    txn();
    this.promoteReady(goalId, newRevision);
    this.logEvent(goalId, "replan.accepted", undefined, { revision: newRevision, taskCount: newPlanTasks.length });
    return created;
  }
  promoteReady(goalId: string, revision?: number): void {
    const all = this.tasks.listByGoal(goalId);
    const succeeded = new Set(all.filter((t) => t.status === TaskStatus.SUCCEEDED).map((t) => t.id));
    for (const t of all) {
      if (t.status !== TaskStatus.PENDING) continue;
      if (revision !== undefined && t.planRevision !== revision) continue;
      if (t.dependencies.every((d) => succeeded.has(d))) {
        const next = t.sideEffectClass === "external" ? TaskStatus.AWAITING_APPROVAL : TaskStatus.READY;
        // external -> awaiting_approval only if side effect external; spec says ready->awaiting for external side-effect class
        this.tasks.update(t.id, { status: next === TaskStatus.AWAITING_APPROVAL ? TaskStatus.AWAITING_APPROVAL : TaskStatus.READY });
        if (next === TaskStatus.READY) this.logEvent(goalId, "task.ready", t.id);
      }
    }
  }

  approve(taskId: string): void {
    const t = this.tasks.get(taskId)!;
    if (t.status !== TaskStatus.AWAITING_APPROVAL) throw new Error("not awaiting approval");
    this.tasks.update(taskId, { status: TaskStatus.READY });
    this.logEvent(t.goalId, "task.approved", taskId);
  }
  reject(taskId: string): void {
    const t = this.tasks.get(taskId)!;
    this.tasks.update(taskId, { status: TaskStatus.CANCELLED, failureReason: "rejected" });
    this.logEvent(t.goalId, "task.rejected", taskId);
  }

  async runGoal(goalId: string): Promise<void> {
    const initialGoal = this.goals.get(goalId);
    if (!initialGoal) throw new Error("goal not found");
    await withSpan("skepd.goal", { "skepd.goal.id": goalId }, async () => {
      const concurrency = this.config.runtime.max_concurrent_tasks;
      while (true) {
      const goal = this.goals.get(goalId);
      if (!goal) throw new Error("goal not found");
      if (goal.status !== "active") break;
      // budget enforcement
      const limits = this.config.limits;
      if (limits.max_goal_duration_seconds !== null) {
        const elapsed = (Date.now() - new Date(goal.createdAt).getTime()) / 1000;
        if (elapsed > limits.max_goal_duration_seconds) {
          this.goals.update(goalId, { status: "failed", completedAt: new Date().toISOString() });
          this.logEvent(goalId, "goal.failed", undefined, { reason: "max_goal_duration_seconds exhausted" });
          break;
        }
      }
      if (limits.max_model_calls !== null) {
        const row = this.raw.prepare("SELECT COUNT(*) as c FROM model_invocations WHERE goal_id = ?").get(goalId) as { c: number };
        if (row.c >= limits.max_model_calls) {
          this.goals.update(goalId, { status: "failed", completedAt: new Date().toISOString() });
          this.logEvent(goalId, "goal.failed", undefined, { reason: "max_model_calls exhausted" });
          break;
        }
      }
      if (limits.max_estimated_cost_usd !== null) {
        const row = this.raw.prepare("SELECT COALESCE(SUM(estimated_cost_usd),0) as s FROM model_invocations WHERE goal_id = ?").get(goalId) as { s: number };
        if (row.s >= limits.max_estimated_cost_usd) {
          this.goals.update(goalId, { status: "failed", completedAt: new Date().toISOString() });
          this.logEvent(goalId, "goal.failed", undefined, { reason: "max_estimated_cost_usd exhausted" });
          break;
        }
      }
      if (this.budget.isExhausted(goalId)) {
        this.goals.update(goalId, { status: "failed", completedAt: new Date().toISOString() });
        this.logEvent(goalId, "goal.failed", undefined, { reason: "budget exhausted" });
        break;
      }
      // promote
      this.promoteReady(goalId);
      // claim
      const now = new Date().toISOString();
      const ready = this.tasks.listReady(now).filter((t) => t.goalId === goalId);
      const slots = concurrency - this.active.size;
      const toClaim = ready.slice(0, Math.max(0, slots));
      const claimed: Task[] = [];
      for (const t of toClaim) {
        const leaseExpires = new Date(Date.now() + this.config.runtime.lease_seconds * 1000).toISOString();
        const ok = this.tasks.claimAtomic(t.id, this.runtimeInstanceId, leaseExpires);
        if (ok) {
          const updated = this.tasks.get(t.id)!;
          // increment attempt handled by claimAtomic via sql; but our update didn't set attempt? claimAtomic sets attempt+1
          claimed.push(updated);
          this.active.add(t.id);
          this.logEvent(goalId, "task.claimed", t.id, { attempt: updated.attempt });
        }
      }
      if (claimed.length === 0 && this.active.size === 0) {
        // check completion
        const all = this.tasks.listByGoal(goalId);
        const activeTasks = all.filter((t) => !["succeeded","failed","cancelled","superseded"].includes(t.status));
        if (activeTasks.length === 0) {
          // determine goal status
          const failed = all.some((t) => t.status === "failed");
          if (failed) {
            this.goals.update(goalId, { status: "failed", completedAt: new Date().toISOString() });
            this.logEvent(goalId, "goal.failed");
          } else {
            this.goals.update(goalId, { status: "succeeded", completedAt: new Date().toISOString() });
            this.logEvent(goalId, "goal.succeeded");
          }
          break;
        }
        // waiting on retries or approvals; sleep
        await new Promise((r) => setTimeout(r, 200));
        continue;
      }
      // dispatch claimed
      await Promise.all(claimed.map((t) => this.executeTask(t, goal)));
      // small
      await new Promise((r) => setTimeout(r, 50));
    }
    });
  }

  async executeTask(task: Task, goal: Goal): Promise<void> {
    await withSpan("skepd.task", { "skepd.goal.id": goal.id, "skepd.task.id": task.id, "skepd.task.attempt": task.attempt, "skepd.worker.type": task.workerType }, async () => {
      const worker = this.workers.get(task.workerType);
    if (!worker) {
      this.tasks.update(task.id, { status: TaskStatus.FAILED, failureReason: "no worker" });
      this.active.delete(task.id);
      this.logEvent(task.goalId, "task.failed", task.id, { reason: "no worker" });
      return;
    }
    const wsPath = this.prepareWorkspace(task, goal);
    const artDir = join(this.artifactsRoot, task.goalId, task.id);
    mkdirSync(artDir, { recursive: true });
    this.tasks.update(task.id, { status: TaskStatus.EXECUTING, workspaceRef: wsPath });
    const heartbeatMs = this.config.runtime.heartbeat_seconds * 1000;
    const leaseMs = this.config.runtime.lease_seconds * 1000;
    const heartbeatTimer = setInterval(() => {
      const expires = new Date(Date.now() + leaseMs).toISOString();
      this.tasks.update(task.id, { leaseExpiresAt: expires, leaseOwner: this.runtimeInstanceId });
    }, heartbeatMs);
    const ctx: WorkerContext = { workspacePath: wsPath, artifactsDir: artDir, tools: {}, repoPath: goal.repoPath ?? undefined, baseCommit: goal.repoPath ? this.baseCommit(goal.repoPath) : undefined };
    try {
      const timeoutMs = this.workerTimeoutMs();
      let timer: NodeJS.Timeout | undefined;
      const result = await Promise.race([
        withSpan("skepd.worker", { "skepd.worker.type": task.workerType, "skepd.task.id": task.id }, () => worker.execute(task, ctx)),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error(`worker timeout after ${timeoutMs}ms`)), timeoutMs);
        }),
      ]);
      clearTimeout(timer);
      // fencing: attempt must match
      const current = this.tasks.get(task.id)!;
      if (result.attempt !== current.attempt || current.leaseOwner !== this.runtimeInstanceId) {
        // stale
        this.logEvent(task.goalId, "task.stale_result", task.id);
        this.active.delete(task.id);
        return;
      }
      // register artifacts: hash files in artDir
      const registered: Artifact[] = [];
      for (const a of result.artifacts) {
        const full = join(artDir, a.path);
        if (!existsSync(full)) continue;
        const buf = readFileSync(full);
        const hash = createHash("sha256").update(buf).digest("hex");
        const art: Artifact = {
          id: a.artifactId, goalId: task.goalId, taskId: task.id, path: a.path, sha256: hash,
          sizeBytes: buf.length, mediaType: null, consumedArtifacts: result.consumedArtifacts ?? [], createdAt: new Date().toISOString(),
        };
        try { this.artifacts.create(art); } catch { /* duplicate */ }
        registered.push(art);
      }
      this.tasks.update(task.id, { status: TaskStatus.VERIFYING, resultSummary: result.summary, evidence: result.evidence });
      this.logEvent(task.goalId, "task.verifying", task.id);
      // verify once, using goal-level test command
      const arts = this.artifacts.listByTask(task.id);
      const patchArtifact = arts.find((a) => a.path === "patch.diff" || a.path.endsWith("patch.diff"));
      const patchPath = patchArtifact ? join(artDir, patchArtifact.path) : undefined;
      const verifyWs = this.prepareVerificationWorkspace(task, goal, patchPath);
      const testLogPath = join(artDir, "test-run.log");
      const runTests = Boolean(goal.testCommand) && (task.workerType === "coding" || task.acceptanceCriteria.some((c) => c.type === "test_pass"));
      const vres = await withSpan("skepd.verification", { "skepd.task.id": task.id }, () => this.verifier.verify(task, arts, { workspacePath: verifyWs, testCommand: runTests ? goal.testCommand : null, testRunLogPath: testLogPath }));
      // register test-run.log if produced
      if (existsSync(testLogPath)) {
        const buf = readFileSync(testLogPath);
        const hash = createHash("sha256").update(buf).digest("hex");
        try { this.artifacts.create({ id: `${task.id}-test-run.log`, goalId: task.goalId, taskId: task.id, path: "test-run.log", sha256: hash, sizeBytes: buf.length, mediaType: "text/plain", consumedArtifacts: [], createdAt: new Date().toISOString() }); } catch { /* duplicate */ }
      }
      const txn = this.raw.transaction(() => {
        this.tasks.update(task.id, { verificationVerdict: vres });
        if (vres.passed) {
          this.tasks.update(task.id, { status: TaskStatus.SUCCEEDED });
        } else {
          const t = this.tasks.get(task.id)!;
          if (t.attempt >= t.maxAttempts) {
            this.tasks.update(task.id, { status: TaskStatus.FAILED, failureReason: vres.reason });
          } else {
            const delay = Math.min(60000, 2000 * Math.pow(2, t.attempt - 1));
            const jitter = Math.random() * delay;
            const next = new Date(Date.now() + jitter).toISOString();
            this.tasks.update(task.id, { status: TaskStatus.READY, nextAttemptAt: next, leaseOwner: null, leaseExpiresAt: null });
          }
        }
      });
      txn();
      if (vres.passed) {
        this.logEvent(task.goalId, "task.succeeded", task.id);
      } else {
        const t = this.tasks.get(task.id)!;
        if (t.attempt >= t.maxAttempts) {
          this.logEvent(task.goalId, "task.failed", task.id, { reason: vres.reason });
        } else {
          this.logEvent(task.goalId, "task.retry_scheduled", task.id, { nextAttemptAt: t.nextAttemptAt ?? undefined });
        }
      }
    } catch (e) {
      try { await worker.cancel(task.id); } catch { /* ignore */ }
      const err = e as Error;
      const t = this.tasks.get(task.id)!;
      if (t.attempt >= t.maxAttempts) {
        this.tasks.update(task.id, { status: TaskStatus.FAILED, failureReason: err.message });
        this.logEvent(task.goalId, "task.failed", task.id, { reason: err.message });
      } else {
        const delay = Math.min(60000, 2000 * Math.pow(2, t.attempt - 1));
        const jitter = Math.random() * delay;
        const next = new Date(Date.now() + jitter).toISOString();
        this.tasks.update(task.id, { status: TaskStatus.READY, nextAttemptAt: next, leaseOwner: null, leaseExpiresAt: null });
          this.logEvent(task.goalId, "task.retry_scheduled", task.id, { reason: err.message, nextAttemptAt: next });
      }
    } finally {
      clearInterval(heartbeatTimer);
      this.active.delete(task.id);
    }
    });
  }

  reconcileInvocation(invocationId: string, outcome: string, evidence?: string): void {
    const inv = this.raw.prepare("SELECT * FROM model_invocations WHERE id = ?").get(invocationId) as { goal_id: string; task_id: string | null } | undefined;
    if (!inv) throw new Error("invocation not found");
    const now = new Date().toISOString();
    const status = outcome === "confirmed" ? "completed" : outcome === "not-applied" ? "failed" : "uncertain";
    this.raw.prepare("UPDATE model_invocations SET status = ?, reconciled_at = ?, reconciliation_outcome = ? WHERE id = ?")
      .run(status, now, JSON.stringify({ outcome, evidence: evidence ?? null, actor: "cli", timestamp: now }), invocationId);
    this.logEvent(inv.goal_id, "reconciliation.completed", inv.task_id ?? undefined, { invocationId, outcome, evidence });
  }

  async cancelGoal(goalId: string): Promise<void> {
    const tasks = this.tasks.listByGoal(goalId);
    const executing = tasks.filter((t) => t.status === TaskStatus.EXECUTING);
    await Promise.all(executing.map(async (t) => {
      const w = this.workers.get(t.workerType);
      if (w) { try { await w.cancel(t.id); } catch { /* ignore */ } }
    }));
    for (const t of tasks) {
      if (!["succeeded","failed","cancelled","superseded"].includes(t.status)) {
        this.tasks.update(t.id, { status: TaskStatus.CANCELLED, leaseOwner: null, leaseExpiresAt: null });
      }
    }
    this.goals.update(goalId, { status: "cancelled", completedAt: new Date().toISOString() });
    this.logEvent(goalId, "goal.cancelled");
  }
}