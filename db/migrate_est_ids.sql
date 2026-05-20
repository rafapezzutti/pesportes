-- ── Migração: suporte a múltiplos estabelecimentos por Gerente ──────────────
-- Execute este SQL no Neon SQL Editor antes de fazer o deploy

-- 1. Adiciona coluna est_ids (array de inteiros) na tabela crm_users
ALTER TABLE crm_users
  ADD COLUMN IF NOT EXISTS est_ids INTEGER[] DEFAULT '{}';

-- 2. Para gerentes já existentes: migra o est_id para o array est_ids
--    (preserva compatibilidade com registros anteriores)
UPDATE crm_users
SET est_ids = ARRAY[est_id]
WHERE role = 'manager'
  AND est_id IS NOT NULL
  AND (est_ids IS NULL OR est_ids = '{}');

-- 3. Reservations: colunas para reserva manual (se ainda não foram criadas)
ALTER TABLE reservations ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE reservations ADD COLUMN IF NOT EXISTS client_name  TEXT;
ALTER TABLE reservations ADD COLUMN IF NOT EXISTS client_phone TEXT;
ALTER TABLE reservations ADD COLUMN IF NOT EXISTS client_email TEXT;
