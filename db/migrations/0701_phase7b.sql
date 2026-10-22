-- Fase 7b: alur tim + coding. 1 run = 1 Pull Request di proyek target.
ALTER TABLE p3_runs ADD COLUMN project TEXT;
ALTER TABLE p3_runs ADD COLUMN branch TEXT;
ALTER TABLE p3_runs ADD COLUMN pr_number INTEGER;
ALTER TABLE p3_runs ADD COLUMN pr_url TEXT;
ALTER TABLE p3_steps ADD COLUMN kind TEXT NOT NULL DEFAULT 'ai';
