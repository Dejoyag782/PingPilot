PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS admins (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  id_hash TEXT PRIMARY KEY,
  admin_id TEXT NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS sessions_expiry_idx ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS targets (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  interval_minutes INTEGER NOT NULL CHECK (interval_minutes IN (1,5,15,30,60)),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0,1)),
  next_run_at TEXT NOT NULL,
  last_run_at TEXT,
  last_status INTEGER,
  last_duration_ms INTEGER,
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS targets_due_idx ON targets(enabled, next_run_at);

CREATE TABLE IF NOT EXISTS ping_logs (
  id TEXT PRIMARY KEY,
  target_id TEXT NOT NULL,
  target_name TEXT NOT NULL,
  target_url TEXT NOT NULL,
  requested_at TEXT NOT NULL,
  finished_at TEXT NOT NULL,
  status_code INTEGER,
  duration_ms INTEGER NOT NULL,
  success INTEGER NOT NULL CHECK (success IN (0,1)),
  error TEXT
);
CREATE INDEX IF NOT EXISTS ping_logs_requested_idx ON ping_logs(requested_at DESC);
CREATE INDEX IF NOT EXISTS ping_logs_target_idx ON ping_logs(target_id, requested_at DESC);
