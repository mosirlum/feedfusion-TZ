-- Feed Fusion Tanzania — Migration 014 (2026-09-12, CLAUDE.md #47)
-- Three unrelated-but-small additions requested together by the owner:
--
-- 1. Forced password change. `must_change_password` is set true whenever a
--    temporary password is assigned on someone's behalf — a brand-new
--    account (createUser) or an owner-initiated reset (resetPassword) — and
--    cleared the moment that person successfully sets their own password
--    (POST /auth/change-password). Existing accounts default to false so
--    nobody already logged in gets forced through this on the next deploy.
--
-- 2. Self-service profile. `avatar_data_url` holds a small data: URL
--    (resized/compressed client-side before upload) rather than a file path
--    — this project has no file-upload middleware or static-serving setup
--    yet, and a single small image per user in a TEXT column is simple and
--    good enough at this scale. NULL means "no photo — show initials", the
--    same fallback the UI already uses everywhere.
--
-- 3. Invoice print tracking. `printed_at` is set the first time a sale's
--    receipt is actually printed (POST /sales/:id/mark-printed), separately
--    from `status` — a sale is still fully COMPLETED and PAID the instant
--    it's rung up (BR-04 unchanged); this only tracks the shop's own
--    paperwork step so Sales History can flag anything left unprinted for
--    more than a week.

ALTER TABLE users ADD COLUMN must_change_password BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN avatar_data_url TEXT;

ALTER TABLE sales ADD COLUMN printed_at TIMESTAMPTZ;
