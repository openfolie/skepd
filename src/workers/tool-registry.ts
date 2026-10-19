export enum SideEffectClass {
  none = "none",
  local_write = "local_write",
  git_write = "git_write",
  network = "network",
  external = "external",
}

export interface ToolDefinition {
  name: string;
  description: string;
  idempotent: boolean;
  hasExternalSideEffects: boolean;
  supportsProviderIdempotencyKey: boolean;
  sideEffectClass: SideEffectClass;
  execute: (...args: unknown[]) => Promise<unknown>;
}

export class ToolRegistry {
  private tools = new Map<string, ToolDefinition>();

  register(tool: ToolDefinition): void {
    this.tools.set(tool.name, tool);
  }

  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  list(): ToolDefinition[] {
    return [...this.tools.values()];
  }

  filterByProfile(profile: string[]): ToolDefinition[] {
    const allowed = new Set(profile);
    return this.list().filter((t) => allowed.has(t.name));
  }
}

export function defaultToolDefinitions(): ToolDefinition[] {
  const noop = async () => ({});
  return [
    { name: "read_file", description: "Read a file", idempotent: true, hasExternalSideEffects: false, supportsProviderIdempotencyKey: false, sideEffectClass: SideEffectClass.none, execute: noop },
    { name: "write_file", description: "Write a file", idempotent: false, hasExternalSideEffects: false, supportsProviderIdempotencyKey: false, sideEffectClass: SideEffectClass.local_write, execute: noop },
    { name: "run_command", description: "Run a command", idempotent: false, hasExternalSideEffects: true, supportsProviderIdempotencyKey: false, sideEffectClass: SideEffectClass.local_write, execute: noop },
    { name: "git_diff", description: "Show git diff", idempotent: true, hasExternalSideEffects: false, supportsProviderIdempotencyKey: false, sideEffectClass: SideEffectClass.none, execute: noop },
    { name: "git_status", description: "Show git status", idempotent: true, hasExternalSideEffects: false, supportsProviderIdempotencyKey: false, sideEffectClass: SideEffectClass.none, execute: noop },
    { name: "git_branch", description: "Manage git branches", idempotent: false, hasExternalSideEffects: true, supportsProviderIdempotencyKey: false, sideEffectClass: SideEffectClass.git_write, execute: noop },
  ];
}