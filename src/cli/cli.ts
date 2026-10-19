import { Command } from "commander";
import { loadConfig } from "../config/config.js";
import { SchedulerService } from "../scheduler/scheduler.js";
import { MockWorker } from "../workers/mock-worker.js";
import { CodingWorker } from "../workers/coding-worker.js";
import { FakePlanner } from "../planning/planner.js";
import { formatTimeline } from "../events/timeline.js";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

function makeScheduler(configPath?: string): SchedulerService {
  const cfg = loadConfig(configPath);
  mkdirSync(cfg.storage.artifacts, { recursive: true });
  const s = new SchedulerService({
    dbPath: cfg.storage.database,
    migrationsDir: join(process.cwd(), "migrations"),
    config: cfg,
    artifactsRoot: cfg.storage.artifacts,
  });
  s.registerWorker(new MockWorker());
  s.registerWorker(new CodingWorker());
  return s;
}

export function buildCli(): Command {
  const program = new Command();
  program.name("skepd").description("Skepd autonomous agent runtime");

  const goal = program.command("goal");

  goal.command("create")
    .argument("<spec>")
    .option("--repo <path>")
    .option("--test-cmd <cmd>")
    .option("--budget <usd>", "", (v: string) => Number(v))
    .option("--deadline <sec>", "", (v: string) => Number(v))
    .option("--config <path>")
    .option("--mock", "create a canned mock plan")
    .option("--plan", "generate a plan with the fake planner")
    .action(async (spec: string, opts: any) => {
      const s = makeScheduler(opts.config);
      const g = s.createGoal(spec, { repoPath: opts.repo, testCommand: opts.testCmd, budgetUsd: opts.budget, deadlineSeconds: opts.deadline });
      console.log(`goal created: ${g.id}`);
      if (opts.mock) {
        s.acceptPlan(g.id, 0, [{
          localKey: "t1", description: "mock task", acceptanceCriteria: [{ id: "a", description: "result file", type: "file_exists", target: "result.txt" }],
          workerType: "mock", sideEffectClass: "none",
        }]);
        console.log("mock plan accepted");
      }
      if (opts.plan) {
        const planner = new FakePlanner();
        const proposal = await planner.plan(g);
        s.acceptPlan(g.id, 0, proposal.tasks);
        console.log("plan accepted");
      }
    });

  goal.command("run")
    .argument("<goalId>")
    .option("--config <path>")
    .action(async (goalId: string, opts: any) => {
      const s = makeScheduler(opts.config);
      await s.runGoal(goalId);
      const g = s.goals.get(goalId);
      console.log(`goal status: ${g?.status}`);
    });

  goal.command("status")
    .argument("<goalId>")
    .option("--config <path>")
    .option("--json")
    .action((goalId: string, opts: any) => {
      const s = makeScheduler(opts.config);
      const g = s.goals.get(goalId);
      if (!g) { console.log("not found"); return; }
      const ts = s.tasks.listByGoal(goalId);
      console.log(`Goal ${g.id} status=${g.status} revision=${g.currentPlanRevision}`);
      console.log(`budget=${g.budgetUsd} deadline=${g.deadlineSeconds}`);
      for (const t of ts) {
        console.log(`  ${t.id} status=${t.status} attempt=${t.attempt}/${t.maxAttempts} worker=${t.workerType}`);
      }
      if (opts.json) console.log(JSON.stringify({ goal: g, tasks: ts }, null, 2));
    });

  goal.command("events")
    .argument("<goalId>")
    .option("--tail <n>", "", (v: string) => Number(v))
    .option("--config <path>")
    .option("--json")
    .action((goalId: string, opts: any) => {
      const s = makeScheduler(opts.config);
      const g = s.goals.get(goalId);
      if (!g) { console.log("not found"); return; }
      const evs = s.events.list(goalId, opts.tail);
      if (opts.json) {
        console.log(JSON.stringify(evs, null, 2));
        return;
      }
      const timelineEvents = evs.map((e: any) => ({
        sequence: e.sequence, type: e.type, taskId: e.taskId, createdAt: e.createdAt,
        payload: (e.payload ?? {}) as Record<string, unknown>,
      }));
      console.log(formatTimeline(timelineEvents, opts.tail));
    });

  goal.command("cancel")
    .argument("<goalId>")
    .option("--config <path>")
    .action(async (goalId: string, opts: any) => {
      const s = makeScheduler(opts.config);
      await s.cancelGoal(goalId);
      console.log("cancelled");
    });

  goal.command("approve")
    .argument("<taskId>")
    .option("--config <path>")
    .action((taskId: string, opts: any) => {
      const s = makeScheduler(opts.config);
      s.approve(taskId);
      console.log("approved");
    });

  goal.command("reject")
    .argument("<taskId>")
    .option("--config <path>")
    .action((taskId: string, opts: any) => {
      const s = makeScheduler(opts.config);
      s.reject(taskId);
      console.log("rejected");
    });

  goal.command("reconcile")
    .argument("<invocationId>")
    .requiredOption("--outcome <outcome>", "confirmed|not-applied|unresolved")
    .option("--evidence <ref>")
    .option("--config <path>")
    .action((invocationId: string, opts: any) => {
      const s = makeScheduler(opts.config);
      s.reconcileInvocation(invocationId, opts.outcome, opts.evidence);
      console.log(`reconciled ${invocationId}: ${opts.outcome}`);
    });

  return program;
}

export {};