-- ================================================================
-- Migração: papéis, est_id em crm_users, payment_method em reservations
-- Execute no Shell do Render: psql $DATABASE_URL -f db/migrate.sql
-- OU cole no SQL Editor do Neon
-- ================================================================

-- 1. Adiciona est_id nos usuários CRM (gerentes e simples ficam vinculados a um est.)
ALTER TABLE crm_users
  ADD COLUMN IF NOT EXISTS est_id INTEGER REFERENCES establishments(id) ON DELETE SET NULL;

-- 2. Amplia o CHECK de role para incluir 'simples'
ALTER TABLE crm_users DROP CONSTRAINT IF EXISTS crm_users_role_check;
ALTER TABLE crm_users
  ADD CONSTRAINT crm_users_role_check CHECK (role IN ('admin', 'manager', 'simples'));

-- 3. Adiciona forma de pagamento nas reservas
ALTER TABLE reservations
  ADD COLUMN IF NOT EXISTS payment_method TEXT DEFAULT 'dinheiro';

ALTER TABLE reservations DROP CONSTRAINT IF EXISTS reservations_payment_method_check;
ALTER TABLE reservations
  ADD CONSTRAINT reservations_payment_method_check
    CHECK (payment_method IN ('pix', 'credito', 'debito', 'dinheiro'));

-- 4. Adiciona reset_token / reset_expires ao crm_users (caso ainda não existam)
ALTER TABLE crm_users ADD COLUMN IF NOT EXISTS reset_token   TEXT;
ALTER TABLE crm_users ADD COLUMN IF NOT EXISTS reset_expires TIMESTAMPTZ;

-- Reserva manual: cliente sem cadastro
ALTER TABLE reservations ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE reservations ADD COLUMN IF NOT EXISTS client_name  TEXT;
ALTER TABLE reservations ADD COLUMN IF NOT EXISTS client_phone TEXT;
ALTER TABLE reservations ADD COLUMN IF NOT EXISTS client_email TEXT;
