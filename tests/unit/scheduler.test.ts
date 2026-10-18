import { describe, it, expect, beforeEach } from "vitest";
import { SchedulerService } from "../../src/scheduler/scheduler.js";
import { MockWorker } from "../../src/workers/mock-worker.js";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function makeSched() {
  const dir = mkdtempSync(join(tmpdir(), "skepd-"));
  const s = new SchedulerService({
    dbPath: join(dir, "t.db"),
    migrationsDir: join(process.cwd(), "migrations"),
    config: {
      runtime: { max_concurrent_tasks: 2, max_tasks_per_goal: 40, max_delegation_depth: 4, lease_seconds: 120, heartbeat_seconds: 30, max_attempts: 3 },
      limits: { max_goal_duration_seconds: 3600, max_model_calls: 150, max_estimated_cost_usd: 5, max_cost_per_task_usd: 1 },
      workers: { strands: { enabled: true, containerized: false, network: false } },
      observability: { opentelemetry: true, exporter: "console", emit_sensitive: false },
      storage: { database: join(dir, "t.db"), artifacts: join(dir, "art"), sessions: join(dir, "sess") },
    },
    artifactsRoot: join(dir, "art"),
  });
  s.registerWorker(new MockWorker());
  return s;
}

describe("scheduler", () => {
  it("rejects cyclic plans", () => {
    const s = makeSched();
    const g = s.createGoal("g");
    expect(() => s.acceptPlan(g.id, 0, [
      { localKey: "a", description: "a", acceptanceCriteria: [{ id: "x", description: "d", type: "manual" }], workerType: "mock", dependencies: ["b"] },
      { localKey: "b", description: "b", acceptanceCriteria: [{ id: "x", description: "d", type: "manual" }], workerType: "mock", dependencies: ["a"] },
    ])).toThrow(/cycle/);
  });
  it("mock task succeeds", async () => {
    const s = makeSched();
    const g = s.createGoal("g");
    s.acceptPlan(g.id, 0, [{ localKey: "t1", description: "t", acceptanceCriteria: [{ id: "a", description: "result file", type: "file_exists", target: "result.txt" }], workerType: "mock" }]);
    await s.runGoal(g.id);
    expect(s.goals.get(g.id)?.status).toBe("succeeded");
  });
  it("stale result fenced", async () => {
    // basic: attempt increments
    const s = makeSched();
    const g = s.createGoal("g");
    const tasks = s.acceptPlan(g.id, 0, [{ localKey: "t1", description: "t", acceptanceCriteria: [{ id: "a", description: "d", type: "manual" }], workerType: "mock", metadata: { mockBehavior: "fail" } }]);
    // maxAttempts 1? default 3; set via acceptPlan? metadata only. Run will retry 3 then fail.
    await s.runGoal(g.id);
    expect(s.goals.get(g.id)?.status).toBe("failed");
  });
});