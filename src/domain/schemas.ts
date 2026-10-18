import { z } from "zod";
import { TaskStatus, GoalStatus, SideEffectClass } from "./enums.js";

export const ArtifactRefSchema = z.object({
  artifactId: z.string(),
  path: z.string(),
  sha256: z.string(),
  sizeBytes: z.number().int().nonnegative(),
  mediaType: z.string().optional(),
});

export const AcceptanceCriterionSchema = z.object({
  id: z.string(),
  description: z.string().min(1),
  type: z.enum(["file_exists", "test_pass", "hash_match", "manual"]).default("manual"),
  target: z.string().optional(),
});

export const TaskSchema = z.object({
  id: z.string(),
  goalId: z.string(),
  planRevision: z.number().int().nonnegative(),
  localKey: z.string().min(1),
  description: z.string().min(1),
  acceptanceCriteria: z.array(AcceptanceCriterionSchema).min(1),
  workerType: z.string(),
  requiredCapabilities: z.array(z.string()).default([]),
  dependencies: z.array(z.string()).default([]),
  status: z.enum([
    "pending", "ready", "executing", "verifying", "succeeded",
    "failed", "cancelled", "superseded", "awaiting_approval",
  ]),
  attempt: z.number().int().nonnegative().default(0),
  maxAttempts: z.number().int().positive().default(3),
  executionDeadline: z.string().nullable().default(null),
  resourceBudgetUsd: z.number().nullable().default(null),
  leaseOwner: z.string().nullable().default(null),
  leaseExpiresAt: z.string().nullable().default(null),
  nextAttemptAt: z.string().nullable().default(null),
  workspaceRef: z.string().nullable().default(null),
  sessionId: z.string().nullable().default(null),
  resultSummary: z.string().nullable().default(null),
  evidence: z.array(z.any()).default([]),
  failureReason: z.string().nullable().default(null),
  verificationVerdict: z.any().nullable().default(null),
  metadata: z.record(z.any()).default({}),
  idempotencyKey: z.string().nullable().default(null),
  sideEffectClass: z.enum(["none", "local_write", "git_write", "network", "external"]).default("none"),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type Task = z.infer<typeof TaskSchema>;

export const GoalSchema = z.object({
  id: z.string(),
  spec: z.string().min(1),
  successCriteria: z.array(z.string()).default([]),
  budgetUsd: z.number().nullable().default(null),
  deadlineSeconds: z.number().int().positive().nullable().default(null),
  allowedCapabilities: z.array(z.string()).default([]),
  status: z.enum(["active", "succeeded", "failed", "cancelled"]),
  currentPlanRevision: z.number().int().nonnegative().default(0),
  repoPath: z.string().nullable().default(null),
  testCommand: z.string().nullable().default(null),
  createdAt: z.string(),
  updatedAt: z.string(),
  completedAt: z.string().nullable().default(null),
});

export type Goal = z.infer<typeof GoalSchema>;

export const EventSchema = z.object({
  id: z.number().int().optional(),
  goalId: z.string(),
  sequence: z.number().int().positive(),
  type: z.string(),
  taskId: z.string().nullable().default(null),
  payload: z.record(z.any()).default({}),
  traceId: z.string().nullable().default(null),
  createdAt: z.string(),
});

export type Event = z.infer<typeof EventSchema>;

export const ArtifactSchema = z.object({
  id: z.string(),
  goalId: z.string(),
  taskId: z.string(),
  path: z.string(),
  sha256: z.string(),
  sizeBytes: z.number().int().nonnegative(),
  mediaType: z.string().nullable().default(null),
  consumedArtifacts: z.array(z.object({ artifactId: z.string(), sha256: z.string() })).default([]),
  createdAt: z.string(),
});

export type Artifact = z.infer<typeof ArtifactSchema>;

export const ModelInvocationSchema = z.object({
  id: z.string(),
  goalId: z.string(),
  taskId: z.string().nullable().default(null),
  status: z.enum(["reserved", "completed", "uncertain", "reconciled"]),
  estimatedCostUsd: z.number().default(0),
  actualCostUsd: z.number().nullable().default(null),
  inputTokens: z.number().int().nullable().default(null),
  outputTokens: z.number().int().nullable().default(null),
  createdAt: z.string(),
  reconciledAt: z.string().nullable().default(null),
  reconciliationOutcome: z.string().nullable().default(null),
});

export type ModelInvocation = z.infer<typeof ModelInvocationSchema>;

// re-export for convenience
export { TaskStatus, GoalStatus, SideEffectClass };