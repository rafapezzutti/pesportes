-- ================================================================
-- Migração: repasse de professores, despesas, avaliações e estoque do bar
-- Execute: psql $DATABASE_URL -f db/migrate_extras.sql
--   ou cole no SQL Editor do Neon. Idempotente.
-- ================================================================

-- #3 Repasse: percentual repassado ao professor sobre o valor do plano/aula
ALTER TABLE professores
  ADD COLUMN IF NOT EXISTS percentual_repasse NUMERIC(5,2) NOT NULL DEFAULT 0;

-- Marca planos já acertados (para não pagar duas vezes)
ALTER TABLE planos_aula
  ADD COLUMN IF NOT EXISTS repasse_pago      BOOLEAN     NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS repasse_pago_em   TIMESTAMPTZ;

-- #9 Despesas operacionais
CREATE TABLE IF NOT EXISTS expenses (
  id          SERIAL PRIMARY KEY,
  est_id      INTEGER REFERENCES establishments(id) ON DELETE CASCADE,
  categoria   TEXT    NOT NULL DEFAULT 'outro',
  descricao   TEXT,
  valor       NUMERIC(10,2) NOT NULL DEFAULT 0,
  vencimento  DATE    NOT NULL,
  pago        BOOLEAN NOT NULL DEFAULT FALSE,
  pago_em     DATE,
  recorrencia TEXT    NOT NULL DEFAULT 'nenhuma',  -- nenhuma | mensal | anual
  observacoes TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_expenses_est ON expenses(est_id);
CREATE INDEX IF NOT EXISTS idx_expenses_venc ON expenses(vencimento);

-- #8 Avaliações (reviews) do marketplace
CREATE TABLE IF NOT EXISTS reviews (
  id          SERIAL PRIMARY KEY,
  target_type TEXT    NOT NULL,  -- 'establishment' | 'profissional'
  target_id   INTEGER NOT NULL,
  user_id     INTEGER REFERENCES public_users(id) ON DELETE SET NULL,
  user_name   TEXT,
  nota        SMALLINT NOT NULL CHECK (nota BETWEEN 1 AND 5),
  comentario  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (target_type, target_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_reviews_target ON reviews(target_type, target_id);

-- #10 Produtos / estoque do bar
CREATE TABLE IF NOT EXISTS bar_produtos (
  id          SERIAL PRIMARY KEY,
  est_id      INTEGER REFERENCES establishments(id) ON DELETE CASCADE,
  nome        TEXT    NOT NULL,
  preco       NUMERIC(10,2) NOT NULL DEFAULT 0,
  estoque     INTEGER NOT NULL DEFAULT 0,
  estoque_min INTEGER NOT NULL DEFAULT 0,
  ativo       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_bar_produtos_est ON bar_produtos(est_id);
