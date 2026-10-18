import { z } from "zod";
import { readFileSync } from "node:fs";
import { parse as parseYaml } from "yaml";

const RuntimeSchema = z.object({
  max_concurrent_tasks: z.number().int().positive().default(3),
  max_tasks_per_goal: z.number().int().positive().default(40),
  max_delegation_depth: z.number().int().positive().default(4),
  lease_seconds: z.number().int().positive().default(120),
  heartbeat_seconds: z.number().int().positive().default(30),
  max_attempts: z.number().int().positive().default(3),
}).default({ max_concurrent_tasks: 3, max_tasks_per_goal: 40, max_delegation_depth: 4, lease_seconds: 120, heartbeat_seconds: 30, max_attempts: 3 });

const LimitsSchema = z.object({
  max_goal_duration_seconds: z.number().int().positive().nullable().default(3600),
  max_model_calls: z.number().int().positive().nullable().default(150),
  max_estimated_cost_usd: z.number().nonnegative().nullable().default(5),
  max_cost_per_task_usd: z.number().nonnegative().nullable().default(1),
}).default({ max_goal_duration_seconds: 3600, max_model_calls: 150, max_estimated_cost_usd: 5, max_cost_per_task_usd: 1 });

const WorkersSchema = z.object({
  strands: z.object({
    enabled: z.boolean().default(true),
    containerized: z.boolean().default(false),
    network: z.boolean().default(false),
  }).default({ enabled: true, containerized: false, network: false }),
}).default({ strands: { enabled: true, containerized: false, network: false } });

const ObsSchema = z.object({
  opentelemetry: z.boolean().default(true),
  exporter: z.enum(["console"]).default("console"),
  emit_sensitive: z.boolean().default(false),
}).default({ opentelemetry: true, exporter: "console", emit_sensitive: false });

const StorageSchema = z.object({
  database: z.string().default("./data/skepd.db"),
  artifacts: z.string().default("./data/artifacts"),
  sessions: z.string().default("./data/sessions"),
}).default({ database: "./data/skepd.db", artifacts: "./data/artifacts", sessions: "./data/sessions" });

export const ConfigSchema = z.object({
  runtime: RuntimeSchema,
  limits: LimitsSchema,
  workers: WorkersSchema,
  observability: ObsSchema,
  storage: StorageSchema,
});

export type Config = z.infer<typeof ConfigSchema>;

export function loadConfig(path?: string): Config {
  let raw: unknown = {};
  if (path) {
    const txt = readFileSync(path, "utf8");
    raw = parseYaml(txt);
  } else {
    try {
      raw = parseYaml(readFileSync("skepd.config.yaml", "utf8"));
    } catch {
      raw = {};
    }
  }
  return ConfigSchema.parse(raw ?? {});
}