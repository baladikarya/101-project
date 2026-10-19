-- Fase 3: tim multi-agent (alur berurutan + dependensi + persetujuan)

CREATE TABLE IF NOT EXISTS p3_runs (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  goal TEXT NOT NULL,
  template TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  attempts INTEGER NOT NULL DEFAULT 1,
  instance_id TEXT,
  current_step INTEGER,
  error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_p3_runs_created ON p3_runs (created_at DESC);

CREATE TABLE IF NOT EXISTS p3_steps (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  idx INTEGER NOT NULL,
  agent TEXT NOT NULL,
  title TEXT NOT NULL,
  depends_on TEXT NOT NULL DEFAULT '[]',
  needs_approval INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',
  output TEXT,
  approval_note TEXT,
  provider TEXT,
  model TEXT,
  prompt_tokens INTEGER,
  completion_tokens INTEGER,
  total_tokens INTEGER,
  latency_ms INTEGER,
  error TEXT,
  updated_at INTEGER NOT NULL,
  UNIQUE (run_id, idx)
);

CREATE INDEX IF NOT EXISTS idx_p3_steps_run ON p3_steps (run_id, idx);

CREATE TABLE IF NOT EXISTS p3_events (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  type TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_p3_events_run ON p3_events (run_id, created_at);

-- Satu baris per panggilan AI (angka dari penyedia). Dipakai untuk batas harian.
CREATE TABLE IF NOT EXISTS p3_usage_logs (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  step_idx INTEGER NOT NULL,
  attempt INTEGER NOT NULL,
  agent TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  prompt_tokens INTEGER,
  completion_tokens INTEGER,
  total_tokens INTEGER,
  latency_ms INTEGER,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_p3_usage_created ON p3_usage_logs (created_at);
CREATE INDEX IF NOT EXISTS idx_p3_usage_run ON p3_usage_logs (run_id);
