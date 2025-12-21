-- D1 migration: add thought_moods table for per-thought mood analysis
-- Note: D1 runs on SQLite.
-- All *_at columns below are Unix epoch seconds in UTC (via sqlite unixepoch()).

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS thought_moods (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  thought_id INTEGER NOT NULL,
  uid TEXT NOT NULL,
  mood_score INTEGER NOT NULL,
  explanation TEXT NOT NULL,
  model TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (thought_id) REFERENCES thoughts(id) ON DELETE CASCADE,
  FOREIGN KEY (uid) REFERENCES users(uid),
  CONSTRAINT chk_mood_score_range CHECK (mood_score >= 1 AND mood_score <= 5)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_thought_moods_thought_id
  ON thought_moods(thought_id);

CREATE INDEX IF NOT EXISTS idx_thought_moods_uid_thought_id
  ON thought_moods(uid, thought_id);
