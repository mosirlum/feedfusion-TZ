-- Feed Fusion Tanzania — Migration 008
-- Audit trail. Depends on 001 (users).

CREATE TABLE audit_logs (
    id          SERIAL PRIMARY KEY,
    user_id     INTEGER REFERENCES users(id),
    action      VARCHAR(80) NOT NULL,
    entity_type VARCHAR(40),
    entity_id   INTEGER,
    details     JSONB,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_logs_entity ON audit_logs(entity_type, entity_id);
