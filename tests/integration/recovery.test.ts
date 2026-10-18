import { describe, it, expect } from "vitest";
import { SchedulerService } from "../../src/scheduler/scheduler.js";
import { MockWorker } from "../../src/workers/mock-worker.js";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function makeSched(dbPath: string, artPath: string) {
  const s = new SchedulerService({
    dbPath,
    migrationsDir: join(process.cwd(), "migrations"),
    config: {
      runtime: { max_concurrent_tasks: 2, max_tasks_per_goal: 40, max_delegation_depth: 4, lease_seconds: 120, heartbeat_seconds: 30, worker_timeout_seconds: 1, max_attempts: 3 },
      limits: { max_goal_duration_seconds: 3600, max_model_calls: 150, max_estimated_cost_usd: 5, max_cost_per_task_usd: 1 },
      workers: { strands: { enabled: true, containerized: false, network: false } },
      observability: { opentelemetry: true, exporter: "console", emit_sensitive: false },
      storage: { database: dbPath, artifacts: artPath, sessions: join(artPath, "sess") },
    },
    artifactsRoot: artPath,
  });
  s.registerWorker(new MockWorker());
  return s;
}

describe("recovery", () => {
  it("revokes stale lease and completes after restart", async () => {
    const dir = mkdtempSync(join(tmpdir(), "skepd-rec-"));
    const dbPath = join(dir, "t.db");
    const artPath = join(dir, "art");
    const s1 = makeSched(dbPath, artPath);
    const g = s1.createGoal("g");
    s1.acceptPlan(g.id, 0, [{ localKey: "t1", description: "t", acceptanceCriteria: [{ id: "a", description: "d", type: "manual" }], workerType: "mock" }]);
    const task = s1.tasks.listByGoal(g.id)[0];
    s1.tasks.update(task.id, { status: "executing", leaseOwner: "old-runtime", leaseExpiresAt: new Date(Date.now() + 60000).toISOString() });

    const s2 = makeSched(dbPath, artPath);
    await s2.runGoal(g.id);
    expect(s2.goals.get(g.id)?.status).toBe("succeeded");
  });
});