-- D1 migration: initial schema
-- Note: D1 runs on SQLite.
-- All *_at columns below are Unix epoch seconds in UTC (via sqlite unixepoch()).

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  uid TEXT PRIMARY KEY,
  email TEXT,
  display_name TEXT,
  photo_url TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  last_seen_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS thoughts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER,
  deleted_at INTEGER,
  status TEXT NOT NULL DEFAULT 'active',
  error TEXT,
  FOREIGN KEY (uid) REFERENCES users(uid)
);

CREATE INDEX IF NOT EXISTS idx_thoughts_uid_created_at_id
  ON thoughts(uid, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_thoughts_uid_deleted_at
  ON thoughts(uid, deleted_at);

CREATE TABLE IF NOT EXISTS tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  last_used_at INTEGER,
  UNIQUE(uid, name),
  FOREIGN KEY (uid) REFERENCES users(uid)
);

CREATE INDEX IF NOT EXISTS idx_tags_uid_last_used_at
  ON tags(uid, last_used_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS thought_tags (
  thought_id INTEGER NOT NULL,
  tag_id INTEGER NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (thought_id, tag_id),
  FOREIGN KEY (thought_id) REFERENCES thoughts(id) ON DELETE CASCADE,
  FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_thought_tags_tag_id
  ON thought_tags(tag_id);

CREATE TABLE IF NOT EXISTS analysis_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  thought_id INTEGER NOT NULL,
  uid TEXT NOT NULL,
  step TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  error TEXT,
  result_json TEXT,
  FOREIGN KEY (thought_id) REFERENCES thoughts(id) ON DELETE CASCADE,
  FOREIGN KEY (uid) REFERENCES users(uid)
);

CREATE INDEX IF NOT EXISTS idx_analysis_jobs_status_created_at
  ON analysis_jobs(status, created_at);

CREATE INDEX IF NOT EXISTS idx_analysis_jobs_thought_id
  ON analysis_jobs(thought_id);
