export const TaskStatus = {
  PENDING: "pending",
  READY: "ready",
  EXECUTING: "executing",
  VERIFYING: "verifying",
  SUCCEEDED: "succeeded",
  FAILED: "failed",
  CANCELLED: "cancelled",
  SUPERSEDED: "superseded",
  AWAITING_APPROVAL: "awaiting_approval",
} as const;
export type TaskStatus = (typeof TaskStatus)[keyof typeof TaskStatus];

export const GoalStatus = {
  ACTIVE: "active",
  SUCCEEDED: "succeeded",
  FAILED: "failed",
  CANCELLED: "cancelled",
} as const;
export type GoalStatus = (typeof GoalStatus)[keyof typeof GoalStatus];

export const SideEffectClass = {
  NONE: "none",
  LOCAL_WRITE: "local_write",
  GIT_WRITE: "git_write",
  NETWORK: "network",
  EXTERNAL: "external",
} as const;
export type SideEffectClass = (typeof SideEffectClass)[keyof typeof SideEffectClass];

export const TerminalTaskStates: TaskStatus[] = [
  TaskStatus.SUCCEEDED,
  TaskStatus.FAILED,
  TaskStatus.CANCELLED,
  TaskStatus.SUPERSEDED,
];

export function isTerminal(s: TaskStatus): boolean {
  return TerminalTaskStates.includes(s);
}