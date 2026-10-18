import { Command } from "commander";
import { loadConfig } from "../config/config.js";
import { SchedulerService } from "../scheduler/scheduler.js";
import { MockWorker } from "../workers/mock-worker.js";
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
    .option("--budget <usd>", "", (v) => Number(v))
    .option("--deadline <sec>", "", (v) => Number(v))
    .option("--config <path>")
    .option("--mock", "create a canned mock plan")
    .action(async (spec, opts) => {
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
    });

  goal.command("run")
    .argument("<goalId>")
    .option("--config <path>")
    .action(async (goalId, opts) => {
      const s = makeScheduler(opts.config);
      await s.runGoal(goalId);
      const g = s.goals.get(goalId);
      console.log(`goal status: ${g?.status}`);
    });

  goal.command("status")
    .argument("<goalId>")
    .option("--config <path>")
    .option("--json")
    .action((goalId, opts) => {
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
    .option("--tail <n>", "", (v) => Number(v))
    .option("--config <path>")
    .action((goalId, opts) => {
      const s = makeScheduler(opts.config);
      const evs = s.events.list(goalId, opts.tail);
      for (const e of evs) console.log(`${e.sequence} ${e.type} ${e.taskId ?? ""}`);
    });

  goal.command("cancel")
    .argument("<goalId>")
    .option("--config <path>")
    .action((goalId, opts) => {
      const s = makeScheduler(opts.config);
      s.cancelGoal(goalId);
      console.log("cancelled");
    });

  goal.command("approve")
    .argument("<taskId>")
    .option("--config <path>")
    .action((taskId, opts) => {
      const s = makeScheduler(opts.config);
      s.approve(taskId);
      console.log("approved");
    });

  goal.command("reject")
    .argument("<taskId>")
    .option("--config <path>")
    .action((taskId, opts) => {
      const s = makeScheduler(opts.config);
      s.reject(taskId);
      console.log("rejected");
    });

  return program;
}

export {};