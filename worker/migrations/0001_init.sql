-- Parchi initial schema (CONTRACT.md "D1 schema").
-- No row exists for a gist until its first comment (lazy create).

CREATE TABLE comments (
  id              TEXT PRIMARY KEY,             -- cmt_… 26 chars
  gist_id         TEXT NOT NULL,
  author          TEXT NOT NULL,                -- free-text display name
  body            TEXT NOT NULL,
  anchor          TEXT NOT NULL,                -- JSON (Anchor type)
  gist_revision   TEXT NOT NULL,                -- gist version SHA at comment time
  status          TEXT NOT NULL DEFAULT 'open', -- open | resolved | deleted
  edit_token_hash TEXT NOT NULL,                -- sha256(edit_token)
  created_at      TEXT NOT NULL,                -- ISO8601
  edited_at       TEXT,
  resolved_at     TEXT,
  resolved_by     TEXT
);
CREATE INDEX idx_comments_gist ON comments(gist_id, status);

-- Per-IP write rate limiting (simple fixed-window counter).
-- One row per accepted write; old rows pruned on each check (ts in ms).
CREATE TABLE rate_limit (
  ip TEXT NOT NULL,
  ts INTEGER NOT NULL
);
CREATE INDEX idx_rate_limit_ip_ts ON rate_limit(ip, ts);
