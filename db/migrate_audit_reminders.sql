-- ================================================================
-- Migração: log de auditoria (LGPD) + flags de lembrete nas reservas
-- Execute: psql $DATABASE_URL -f db/migrate_audit_reminders.sql
--   ou cole no SQL Editor do Neon
-- Idempotente — pode rodar mais de uma vez.
-- ================================================================

-- 1. Tabela de auditoria
CREATE TABLE IF NOT EXISTS audit_logs (
  id          BIGSERIAL PRIMARY KEY,
  user_id     INTEGER,
  user_type   TEXT,                 -- 'crm' | 'public'
  user_role   TEXT,                 -- admin | manager | simples | profissional
  est_id      INTEGER,
  action      TEXT NOT NULL,        -- 'create' | 'update' | 'delete' | 'login'
  entity      TEXT,                 -- 'reservations', 'establishments', etc.
  entity_id   TEXT,
  method      TEXT,
  path        TEXT,
  status_code INTEGER,
  details     JSONB,                -- payload sanitizado (sem senhas/fotos)
  ip          TEXT,
  user_agent  TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_user    ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_entity  ON audit_logs(entity);
CREATE INDEX IF NOT EXISTS idx_audit_action  ON audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_audit_est     ON audit_logs(est_id);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at DESC);

-- 2. Flags de lembrete (corrige cron que perdia horários quebrados)
ALTER TABLE reservations ADD COLUMN IF NOT EXISTS reminded_1h  BOOLEAN DEFAULT FALSE;
ALTER TABLE reservations ADD COLUMN IF NOT EXISTS reminded_15m BOOLEAN DEFAULT FALSE;
