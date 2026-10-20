-- Fase 5: riwayat tugas coding (agent -> branch -> Pull Request).
CREATE TABLE IF NOT EXISTS p5_code_tasks (
  id TEXT PRIMARY KEY,
  instruction TEXT NOT NULL,
  paths TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL,
  title TEXT,
  branch TEXT,
  pr_number INTEGER,
  pr_url TEXT,
  error TEXT,
  model TEXT,
  prompt_tokens INTEGER,
  completion_tokens INTEGER,
  total_tokens INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_p5_code_tasks_created ON p5_code_tasks (created_at DESC);
