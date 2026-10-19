import type { Goal } from "../domain/schemas.js";
import type { PlanTaskInput } from "../scheduler/scheduler.js";

export interface PlanProposal {
  tasks: PlanTaskInput[];
}

export interface Planner {
  plan(goal: Goal): Promise<PlanProposal>;
}

export class FakePlanner implements Planner {
  async plan(goal: Goal): Promise<PlanProposal> {
    if (goal.repoPath) {
      return {
        tasks: [
          {
            localKey: "inspect",
            description: "Inspect repository and reproduce the issue",
            acceptanceCriteria: [{ id: "inspect", description: "inspection complete", type: "file_exists", target: "result.txt" }],
            workerType: "mock",
          },
          {
            localKey: "fix",
            description: "Apply a minimal fix and generate a patch",
            acceptanceCriteria: [{ id: "patch", description: "patch file", type: "file_exists", target: "patch.diff" }],
            workerType: "coding",
            dependencies: ["inspect"],
            sideEffectClass: "git_write",
            metadata: { commands: ["node scripts/fix.js"] },
          },
        ],
      };
    }
    return {
      tasks: [
        {
          localKey: "t1",
          description: "mock task",
          acceptanceCriteria: [{ id: "a", description: "result file", type: "file_exists", target: "result.txt" }],
          workerType: "mock",
        },
      ],
    };
  }
}