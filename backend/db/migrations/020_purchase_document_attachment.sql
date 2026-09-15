-- Feed Fusion Tanzania — Migration 020
-- Lets a purchase carry one photo of the supplier's invoice/quotation
-- (2026-09-14, CLAUDE.md #68). Same pattern already used for user avatars
-- (migration 014, users.avatar_data_url): stored as a base64 data: URL,
-- not an uploaded file — this backend has no file-upload middleware or
-- static file serving, and the frontend resizes/compresses the photo via
-- <canvas> client-side before it's ever sent, so it never bloats the
-- purchases table with a multi-megabyte string. One attachment per
-- purchase, by the owner's own choice — not a list of files.
ALTER TABLE purchases ADD COLUMN document_data_url TEXT;
