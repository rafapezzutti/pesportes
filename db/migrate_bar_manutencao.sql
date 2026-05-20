-- ================================================================
-- Migração: Vendas de Bar e Manutenção
-- Execute no painel SQL do Neon
-- ================================================================

-- Tabela de Vendas do Bar
-- itens: JSON array de [{nome, quantidade, valor_unitario}]
CREATE TABLE IF NOT EXISTS bar_vendas (
  id             SERIAL PRIMARY KEY,
  est_id         INTEGER REFERENCES establishments(id) ON DELETE CASCADE,
  cliente_nome   TEXT    NOT NULL,
  cliente_ref    TEXT,   -- 'public:123' | 'plano:456' | 'manual'
  itens          JSONB   NOT NULL DEFAULT '[]',
  total          NUMERIC(10,2) NOT NULL DEFAULT 0,
  observacoes    TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bar_vendas_est_id ON bar_vendas(est_id);
CREATE INDEX IF NOT EXISTS idx_bar_vendas_cliente ON bar_vendas(cliente_nome);

-- Tabela de Manutenção / Equipamentos
CREATE TABLE IF NOT EXISTS manutencao_vendas (
  id             SERIAL PRIMARY KEY,
  est_id         INTEGER REFERENCES establishments(id) ON DELETE CASCADE,
  cliente_nome   TEXT    NOT NULL,
  cliente_ref    TEXT,
  itens          JSONB   NOT NULL DEFAULT '[]',
  total          NUMERIC(10,2) NOT NULL DEFAULT 0,
  observacoes    TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_manutencao_est_id ON manutencao_vendas(est_id);
CREATE INDEX IF NOT EXISTS idx_manutencao_cliente ON manutencao_vendas(cliente_nome);
