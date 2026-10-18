import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";

export const goals = sqliteTable("goals", {
  id: text("id").primaryKey(),
  spec: text("spec").notNull(),
  successCriteria: text("success_criteria").notNull().default("[]"),
  budgetUsd: real("budget_usd"),
  deadlineSeconds: integer("deadline_seconds"),
  allowedCapabilities: text("allowed_capabilities").notNull().default("[]"),
  status: text("status").notNull().default("active"),
  currentPlanRevision: integer("current_plan_revision").notNull().default(0),
  repoPath: text("repo_path"),
  testCommand: text("test_command"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  completedAt: text("completed_at"),
});

export const tasks = sqliteTable("tasks", {
  id: text("id").primaryKey(),
  goalId: text("goal_id").notNull().references(() => goals.id),
  planRevision: integer("plan_revision").notNull(),
  localKey: text("local_key").notNull(),
  description: text("description").notNull(),
  acceptanceCriteria: text("acceptance_criteria").notNull().default("[]"),
  workerType: text("worker_type").notNull(),
  requiredCapabilities: text("required_capabilities").notNull().default("[]"),
  dependencies: text("dependencies").notNull().default("[]"),
  status: text("status").notNull().default("pending"),
  attempt: integer("attempt").notNull().default(0),
  maxAttempts: integer("max_attempts").notNull().default(3),
  executionDeadline: text("execution_deadline"),
  resourceBudgetUsd: real("resource_budget_usd"),
  leaseOwner: text("lease_owner"),
  leaseExpiresAt: text("lease_expires_at"),
  nextAttemptAt: text("next_attempt_at"),
  workspaceRef: text("workspace_ref"),
  sessionId: text("session_id"),
  resultSummary: text("result_summary"),
  evidence: text("evidence").notNull().default("[]"),
  failureReason: text("failure_reason"),
  verificationVerdict: text("verification_verdict"),
  metadata: text("metadata").notNull().default("{}"),
  idempotencyKey: text("idempotency_key"),
  sideEffectClass: text("side_effect_class").notNull().default("none"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (t) => ({
  // unique constraint handled in migration SQL
}));

export const events = sqliteTable("events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  goalId: text("goal_id").notNull().references(() => goals.id),
  sequence: integer("sequence").notNull(),
  type: text("type").notNull(),
  taskId: text("task_id"),
  payload: text("payload").notNull().default("{}"),
  traceId: text("trace_id"),
  createdAt: text("created_at").notNull(),
});

export const artifacts = sqliteTable("artifacts", {
  id: text("id").primaryKey(),
  goalId: text("goal_id").notNull().references(() => goals.id),
  taskId: text("task_id").notNull().references(() => tasks.id),
  path: text("path").notNull(),
  sha256: text("sha256").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  mediaType: text("media_type"),
  consumedArtifacts: text("consumed_artifacts").notNull().default("[]"),
  createdAt: text("created_at").notNull(),
});

export const modelInvocations = sqliteTable("model_invocations", {
  id: text("id").primaryKey(),
  goalId: text("goal_id").notNull().references(() => goals.id),
  taskId: text("task_id").references(() => tasks.id),
  status: text("status").notNull().default("reserved"),
  estimatedCostUsd: real("estimated_cost_usd").notNull().default(0),
  actualCostUsd: real("actual_cost_usd"),
  inputTokens: integer("input_tokens"),
  outputTokens: integer("output_tokens"),
  createdAt: text("created_at").notNull(),
  reconciledAt: text("reconciled_at"),
  reconciliationOutcome: text("reconciliation_outcome"),
});