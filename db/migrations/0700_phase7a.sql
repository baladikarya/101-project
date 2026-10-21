-- Fase 7a: proyek target terpisah. Agent hanya boleh menyentuh repo yang terdaftar di sini.
CREATE TABLE IF NOT EXISTS p7_projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  repo TEXT NOT NULL UNIQUE,
  worker TEXT,
  status TEXT NOT NULL DEFAULT 'new',
  kind TEXT NOT NULL DEFAULT 'external',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

INSERT OR IGNORE INTO p7_projects (id, name, repo, worker, status, kind, created_at, updated_at) VALUES
  ('101-project', '101-project', 'baladikarya/101-project', '101-project', 'active', 'self',
   CAST(strftime('%s','now') AS INTEGER) * 1000, CAST(strftime('%s','now') AS INTEGER) * 1000),
  ('demo-landing', 'demo-landing', 'baladikarya/demo-landing', 'demo-landing', 'new', 'external',
   CAST(strftime('%s','now') AS INTEGER) * 1000, CAST(strftime('%s','now') AS INTEGER) * 1000);

ALTER TABLE p5_code_tasks ADD COLUMN project TEXT;
