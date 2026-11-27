-- "Welcome back" summary + voice greeting (2026-11-27, CLAUDE.md #99) —
-- needs to know when this user last signed in, so the summary covers only
-- what happened since then rather than since the dawn of time.
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;
