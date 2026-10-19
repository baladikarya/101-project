CREATE TABLE IF NOT EXISTS p2_tasks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  prompt TEXT NOT NULL,
  agent TEXT NOT NULL DEFAULT 'ai-manager',
  status TEXT NOT NULL DEFAULT 'queued',
  attempts INTEGER NOT NULL DEFAULT 1,
  instance_id TEXT,
  provider TEXT,
  model TEXT,
  result TEXT,
  error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_p2_tasks_created ON p2_tasks (created_at DESC);

CREATE TABLE IF NOT EXISTS p2_task_events (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  type TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_p2_events_task ON p2_task_events (task_id, created_at);

CREATE TABLE IF NOT EXISTS p2_usage_logs (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  attempt INTEGER NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  prompt_tokens INTEGER,
  completion_tokens INTEGER,
  total_tokens INTEGER,
  latency_ms INTEGER,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_p2_usage_task ON p2_usage_logs (task_id);
CREATE INDEX IF NOT EXISTS idx_p2_usage_created ON p2_usage_logs (created_at);
