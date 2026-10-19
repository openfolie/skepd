// Terminal timeline formatter for Skepd events.
// Renders a compact, icon-prefixed chronological view of goal execution.

const ICONS: Record<string, string> = {
  "goal.created": "🎯",
  "goal.succeeded": "✅",
  "goal.failed": "❌",
  "goal.cancelled": "🚫",
  "plan.accepted": "📋",
  "plan.rejected": "⛔",
  "task.created": "➕",
  "task.ready": "🟡",
  "task.claimed": "🔒",
  "task.completed": "📤",
  "task.verifying": "🔍",
  "task.succeeded": "✅",
  "task.failed": "❌",
  "task.retry_scheduled": "🔄",
  "task.cancelled": "🚫",
  "task.recovered": "♻️",
  "task.stale_result": "⚠️",
  "worker.started": "▶️",
  "worker.failed": "💥",
  "verification.passed": "✅",
  "verification.failed": "❌",
  "lease.expired": "⏰",
  "lease.revoked": "🔓",
  "recovery.started": "♻️",
  "recovery.completed": "🏁",
  "budget.warning": "⚠️",
  "budget.exhausted": "🛑",
  "replan.requested": "🔁",
  "replan.accepted": "📋",
  "replan.rejected": "⛔",
  "task.approved": "👍",
  "task.rejected": "👎",
};

// Only these event types appear in the terminal timeline (filtered view).
const TIMELINE_TYPES = new Set([
  "task.claimed",
  "worker.failed",
  "task.retry_scheduled",
  "task.recovered",
  "verification.passed",
  "verification.failed",
  "task.succeeded",
  "task.failed",
  "goal.succeeded",
  "goal.failed",
  "task.stale_result",
  "lease.expired",
  "recovery.started",
  "recovery.completed",
]);

export interface TimelineEvent {
  sequence: number;
  type: string;
  taskId: string | null;
  createdAt: string;
  payload: Record<string, unknown>;
}

export function formatTimeline(events: TimelineEvent[], tail?: number): string {
  const filtered = events.filter((e) => TIMELINE_TYPES.has(e.type));
  const sliced = tail ? filtered.slice(-tail) : filtered;
  const lines: string[] = [];
  for (const e of sliced) {
    const icon = ICONS[e.type] ?? "•";
    const task = e.taskId ? ` [${e.taskId.slice(0, 8)}]` : "";
    const detail = formatDetail(e);
    lines.push(`${icon} ${e.sequence.toString().padStart(3)} ${e.type}${task}${detail}`);
  }
  if (lines.length === 0) {
    lines.push("(no timeline events)");
  }
  return lines.join("\n");
}

function formatDetail(e: TimelineEvent): string {
  const p = e.payload ?? {};
  const parts: string[] = [];
  if (p.attempt !== undefined) parts.push(`attempt=${p.attempt}`);
  if (p.reason) parts.push(`reason=${String(p.reason).slice(0, 60)}`);
  if (p.nextAttemptAt) parts.push(`next=${p.nextAttemptAt}`);
  if (p.taskCount !== undefined) parts.push(`tasks=${p.taskCount}`);
  return parts.length > 0 ? "  " + parts.join(" ") : "";
}

export function isTimelineEvent(type: string): boolean {
  return TIMELINE_TYPES.has(type);
}
