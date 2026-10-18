CREATE TABLE goals (
  id TEXT PRIMARY KEY,
  spec TEXT NOT NULL,
  success_criteria TEXT NOT NULL DEFAULT '[]',
  budget_usd REAL,
  deadline_seconds INTEGER,
  allowed_capabilities TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'active',
  current_plan_revision INTEGER NOT NULL DEFAULT 0,
  repo_path TEXT,
  test_command TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  goal_id TEXT NOT NULL REFERENCES goals(id),
  plan_revision INTEGER NOT NULL,
  local_key TEXT NOT NULL,
  description TEXT NOT NULL,
  acceptance_criteria TEXT NOT NULL DEFAULT '[]',
  worker_type TEXT NOT NULL,
  required_capabilities TEXT NOT NULL DEFAULT '[]',
  dependencies TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'pending',
  attempt INTEGER NOT NULL DEFAULT 0 CHECK (attempt >= 0),
  max_attempts INTEGER NOT NULL DEFAULT 3,
  execution_deadline TEXT,
  resource_budget_usd REAL,
  lease_owner TEXT,
  lease_expires_at TEXT,
  next_attempt_at TEXT,
  workspace_ref TEXT,
  session_id TEXT,
  result_summary TEXT,
  evidence TEXT NOT NULL DEFAULT '[]',
  failure_reason TEXT,
  verification_verdict TEXT,
  metadata TEXT NOT NULL DEFAULT '{}',
  idempotency_key TEXT,
  side_effect_class TEXT NOT NULL DEFAULT 'none',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (goal_id, plan_revision, local_key)
);

CREATE TABLE events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  goal_id TEXT NOT NULL REFERENCES goals(id),
  sequence INTEGER NOT NULL,
  type TEXT NOT NULL,
  task_id TEXT,
  payload TEXT NOT NULL DEFAULT '{}',
  trace_id TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (goal_id, sequence)
);

CREATE TABLE artifacts (
  id TEXT PRIMARY KEY,
  goal_id TEXT NOT NULL REFERENCES goals(id),
  task_id TEXT NOT NULL REFERENCES tasks(id),
  path TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0),
  media_type TEXT,
  consumed_artifacts TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  UNIQUE (goal_id, task_id, path)
);

CREATE TABLE model_invocations (
  id TEXT PRIMARY KEY,
  goal_id TEXT NOT NULL REFERENCES goals(id),
  task_id TEXT REFERENCES tasks(id),
  status TEXT NOT NULL DEFAULT 'reserved',
  estimated_cost_usd REAL NOT NULL DEFAULT 0 CHECK (estimated_cost_usd >= 0),
  actual_cost_usd REAL,
  input_tokens INTEGER,
  output_tokens INTEGER,
  created_at TEXT NOT NULL,
  reconciled_at TEXT,
  reconciliation_outcome TEXT
);

CREATE INDEX idx_tasks_goal_status ON tasks(goal_id, status);
CREATE INDEX idx_events_goal_seq ON events(goal_id, sequence);
CREATE INDEX idx_artifacts_goal_task ON artifacts(goal_id, task_id);