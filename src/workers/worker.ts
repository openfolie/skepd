import type { Task, Artifact } from "../domain/schemas.js";

export interface ArtifactReference {
  artifactId: string;
  path: string;
  sha256: string;
}

export interface WorkerResult {
  summary: string;
  artifacts: ArtifactReference[];
  evidence: unknown[];
  consumedArtifacts?: { artifactId: string; sha256: string }[];
  attempt: number;
  usage?: { inputTokens?: number; outputTokens?: number; estimatedCost?: number };
}

export interface WorkerHealth { available: boolean; activeTasks: number; }

export interface WorkerRunner {
  type: string;
  execute(task: Task, ctx: WorkerContext): Promise<WorkerResult>;
  cancel(taskId: string): Promise<void>;
  health(): Promise<WorkerHealth>;
}

export interface WorkerContext {
  workspacePath: string;
  artifactsDir: string;
  tools: Record<string, (...args: unknown[]) => Promise<unknown>>;
}