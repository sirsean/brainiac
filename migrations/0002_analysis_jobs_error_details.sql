-- D1 migration: add analysis_jobs error detail columns
-- Note: D1 runs on SQLite.

ALTER TABLE analysis_jobs ADD COLUMN error_stack TEXT;
ALTER TABLE analysis_jobs ADD COLUMN error_details_json TEXT;
