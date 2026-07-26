-- D1 migration: therapy prep analysis reports
-- Note: D1 runs on SQLite.
-- All *_at columns below are Unix epoch seconds in UTC (via sqlite unixepoch()).

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS therapy_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  tz_offset_min INTEGER NOT NULL DEFAULT 0,
  thought_count INTEGER NOT NULL DEFAULT 0,
  model TEXT,
  status TEXT NOT NULL DEFAULT 'running',
  thinking_text TEXT,
  report_markdown TEXT,
  meta_json TEXT,
  error TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (uid) REFERENCES users(uid),
  CONSTRAINT chk_therapy_report_status CHECK (status IN ('running', 'done', 'error'))
);

CREATE INDEX IF NOT EXISTS idx_therapy_reports_uid_created_at
  ON therapy_reports(uid, created_at DESC);
