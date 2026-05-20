-- ── Migração: colunas de reset de senha ──────────────────────────
-- Execute este SQL no Neon SQL Editor antes do deploy

-- Usuários CRM
ALTER TABLE crm_users
  ADD COLUMN IF NOT EXISTS reset_token   TEXT,
  ADD COLUMN IF NOT EXISTS reset_expires TIMESTAMPTZ;

-- Usuários Públicos
ALTER TABLE public_users
  ADD COLUMN IF NOT EXISTS reset_token   TEXT,
  ADD COLUMN IF NOT EXISTS reset_expires TIMESTAMPTZ;
