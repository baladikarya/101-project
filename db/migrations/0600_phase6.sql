-- Fase 6: hardening (rate limit, audit log lengkap, penanda pembersihan).
-- Idempoten (IF NOT EXISTS): aman ditempel ulang di D1 Console.
-- Waktu: p6_audit_log.ts epoch milidetik; p6_rate_limits.window_start epoch detik.

CREATE TABLE IF NOT EXISTS p6_rate_limits (
  key          TEXT    NOT NULL,
  window_start INTEGER NOT NULL,
  count        INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (key, window_start)
);
CREATE INDEX IF NOT EXISTS idx_p6_rate_limits_window ON p6_rate_limits (window_start);

CREATE TABLE IF NOT EXISTS p6_audit_log (
  id     INTEGER PRIMARY KEY AUTOINCREMENT,
  ts     INTEGER NOT NULL,
  actor  TEXT,
  ip     TEXT,
  method TEXT    NOT NULL,
  path   TEXT    NOT NULL,
  status INTEGER NOT NULL,
  ms     INTEGER
);
CREATE INDEX IF NOT EXISTS idx_p6_audit_log_ts ON p6_audit_log (ts);

CREATE TABLE IF NOT EXISTS p6_meta (
  key   TEXT PRIMARY KEY,
  value INTEGER NOT NULL
);
