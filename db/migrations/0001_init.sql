-- Fase 1: autentikasi single owner + audit log.
-- Idempoten (IF NOT EXISTS): aman ditempel ulang di D1 Console.
-- Waktu disimpan sebagai epoch milidetik (UTC).

CREATE TABLE IF NOT EXISTS users (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  github_id   INTEGER NOT NULL UNIQUE,
  login       TEXT    NOT NULL,
  avatar_url  TEXT,
  created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash  TEXT    PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS audit_logs (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  ts      INTEGER NOT NULL,
  actor   TEXT,
  action  TEXT    NOT NULL,
  detail  TEXT
);
