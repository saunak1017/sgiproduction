PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('admin','vendor')),
  password_hash TEXT NOT NULL, salt TEXT NOT NULL, iterations INTEGER NOT NULL CHECK(iterations BETWEEN 1 AND 100000),
  active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);
CREATE TABLE IF NOT EXISTS login_attempts (
  key TEXT PRIMARY KEY, failures INTEGER NOT NULL, reset_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS projects (
  number INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL DEFAULT '', metal TEXT NOT NULL DEFAULT '', quantity TEXT NOT NULL DEFAULT '',
  delivery_date TEXT NOT NULL DEFAULT '', spec_json TEXT NOT NULL,
  stage INTEGER NOT NULL DEFAULT 0 CHECK(stage BETWEEN 0 AND 7),
  cost TEXT NOT NULL DEFAULT '', cost_basis TEXT NOT NULL DEFAULT 'order', invoice TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 1, last_event TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS projects_delivery ON projects(stage,delivery_date);
CREATE TABLE IF NOT EXISTS stage_history (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id),
  from_stage INTEGER, to_stage INTEGER NOT NULL, actor_id TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS history_project ON stage_history(project_id,created_at);
CREATE TABLE IF NOT EXISTS comments (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), actor_id TEXT NOT NULL REFERENCES users(id),
  body TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS comments_project ON comments(project_id,created_at);
CREATE TABLE IF NOT EXISTS files (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), actor_id TEXT NOT NULL REFERENCES users(id),
  bucket TEXT NOT NULL CHECK(bucket IN ('reference','stl','3dm')), name TEXT NOT NULL,
  object_key TEXT NOT NULL UNIQUE, size INTEGER NOT NULL, mime TEXT NOT NULL,
  upload_id TEXT, ready INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS files_project ON files(project_id,ready);
CREATE TABLE IF NOT EXISTS upload_parts (
  file_id TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  part_number INTEGER NOT NULL, etag TEXT NOT NULL, PRIMARY KEY(file_id,part_number)
);
CREATE TABLE IF NOT EXISTS notification_outbox (
  id TEXT PRIMARY KEY, event_id TEXT NOT NULL, recipient TEXT NOT NULL,
  kind TEXT NOT NULL, project_id TEXT, payload TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','sending','sent','failed')),
  attempts INTEGER NOT NULL DEFAULT 0, next_attempt TEXT NOT NULL,
  first_attempt TEXT, last_attempt TEXT, sent_at TEXT, provider_id TEXT, error TEXT,
  created_at TEXT NOT NULL, UNIQUE(event_id,recipient)
);
CREATE INDEX IF NOT EXISTS outbox_pending ON notification_outbox(status,next_attempt);
CREATE TABLE IF NOT EXISTS worker_state (
  key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL
);
