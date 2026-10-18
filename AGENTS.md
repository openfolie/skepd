# Skepd — Agent Reference

## Project Overview

Skepd is a general-purpose autonomous agent runtime. Accepts a high-level goal, decomposes into tasks, delegates to workers, verifies results, recovers from failures. Single-host, TypeScript, SQLite control plane.

## Documentation Index

All design documentation lives in `docs/`. Read these before making changes.

### Primary Design Document

- `docs/RFC-001.md` — Full RFC with frozen MVP design. **Read this first.** Covers architecture, state machine, scheduling, persistence, verification, side effects, configuration, CLI, and implementation plan.

### Key Sections in RFC-001.md

| Section | Topic | When to reference |
|---|---|---|
| §5 | Architecture & worker interface | Adding workers, understanding control flow |
| §6 | Task model & lifecycle (9 states) | State transitions, replanning, delegation |
| §7 | Scheduling & execution | Claiming, leases, retries, concurrency |
| §8 | Persistence & storage (5 tables) | Schema changes, artifacts, workspaces |
| §9 | Isolation & permissions | Worker boundaries, approval |
| §10 | Verification | Independent verification, acceptance criteria |
| §11 | Observability | OTel spans, trace correlation |
| §14 | Configuration | Config schema, validation, env vars |
| §16 | Acceptance criteria | What "done" means for MVP |
| §17 | CLI commands | Command set and output format |
| §18 | Tool registry | Tool metadata, side-effect classes |
| §20 | Idempotency | operationId vs attempt, non-idempotent ops |
| §21 | Uncertain outcomes | Reconciliation, conservative accounting |

## Repository Structure

```
src/
  config/        # Zod config schema, loader
  db/            # Drizzle schema, client, migrations runner, repositories/
  domain/        # Zod schemas, types, enums, errors (no Drizzle imports)
  scheduler/     # SchedulerService, claims, leases, recovery, transitions
  planning/      # PlanningService, Strands planner adapter, plan validator
  verification/  # VerificationService, deterministic checks
  workers/       # WorkerRunner interface, adapters, registry
  budget/        # BudgetService, reservation/reconciliation
  events/        # EventService, terminal timeline formatter
  observability/ # OTel setup (console exporter)
  cli/           # Command handlers (commander.js)
  index.ts       # Entry point
migrations/      # Numbered SQL files
tests/
  unit/
  integration/
  fixtures/
docs/
  RFC-001.md     # This project's design document
```

## Tech Stack

- **Language**: TypeScript (Node.js)
- **ORM**: Drizzle + better-sqlite3
- **Validation**: Zod
- **CLI**: commander.js
- **Testing**: Vitest
- **Observability**: OpenTelemetry (console exporter)
- **Planning**: Strands TypeScript SDK

## Key Invariants

1. **SQLite is the source of truth.** Task state, leases, budgets, events all live in SQLite. Agent transcripts are not authoritative.
2. **Scheduler owns all state transitions.** Workers never mutate DB. Workers propose effects; scheduler authorizes durable state transitions.
3. **Fencing via attempt counter.** Every claim increments `attempt`. Results must echo it. Stale results are rejected.
4. **Recovery revokes before redispatch.** On restart, all leases from previous runtimeInstances are revoked before new claims.
5. **Verification is independent.** Worker claims are never trusted. Verifier checks actual files, runs tests independently.
6. **Atomic plan acceptance.** Validate entire DAG before persisting. No partial plans.
7. **Conservative accounting.** Uncertain model calls retain reservations. Aborted calls are not free.
8. **Trusted-user-only MVP.** Filesystem sandboxing is not a security boundary. No Docker isolation yet.

## State Machine (9 states)

`pending → ready → executing → verifying → succeeded | failed | cancelled | superseded | awaiting_approval`

## Task State Transitions

- `pending → ready`: all dependencies succeeded (transactional)
- `ready → executing`: atomic claim (attempt incremented, lease assigned)
- `executing → verifying`: worker completed (fencing token validated)
- `verifying → succeeded`: verification pass
- `verifying → ready`: verification fail + retry (sets nextAttemptAt)
- `verifying → failed`: verification fail + exhausted
- Any non-terminal → `cancelled`: explicit cancel
- `ready → awaiting_approval`: external side-effect class
- `awaiting_approval → ready`: explicit approval
- Unfinished tasks in old revision → `superseded`: on replan

## Scope Guard

> Skepd must demonstrate autonomous execution under failure, not merely task decomposition.

**Core (do not cut):** goal decomposition, durable SQLite state, atomic claims, one real worker, retries/recovery, independent verification, artifact provenance, failure-injection scenario.

**Stretch:** second worker harness, bounded replanning, OTel export, Docker isolation, richer cost accounting, model-based verification.

**Safe to cut first:** distributed scheduling, web dashboard, custom queue infra, plugin discovery, workflow DSLs.

## Conventions

- No barrel files; use direct imports.
- Domain types in `src/domain/` must not import Drizzle.
- Repository methods are thin; multi-table transactions live in domain services.
- Migrations are numbered SQL files in `migrations/`, committed (not runtime-generated).
- Tests: Vitest, in-memory SQLite for unit, temp file DB for integration/recovery.
- No real LLM calls in CI; use fake Strands planner with canned plans.
- Credentials via environment variables, never in config or code.
- Config: `null` = explicitly unlimited; never `0` or missing.
