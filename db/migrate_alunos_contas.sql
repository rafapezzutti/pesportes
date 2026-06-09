-- ================================================================
-- Migração: Alunos + Colunas de Pagamento + Foto Bar
-- Execute no Neon SQL Editor
-- ================================================================

-- Tabela de Alunos
CREATE TABLE IF NOT EXISTS alunos (
  id              SERIAL PRIMARY KEY,
  nome            TEXT NOT NULL,
  cpf             TEXT,
  email           TEXT,
  data_nascimento DATE,
  est_id          INTEGER REFERENCES establishments(id) ON DELETE SET NULL,
  ativo           BOOLEAN DEFAULT TRUE,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_alunos_nome   ON alunos(nome);
CREATE INDEX IF NOT EXISTS idx_alunos_est_id ON alunos(est_id);

-- Foto no registro de Bar
ALTER TABLE bar_vendas ADD COLUMN IF NOT EXISTS foto TEXT;

-- Status de Pagamento (pendente / pago / em_atraso)
ALTER TABLE bar_vendas        ADD COLUMN IF NOT EXISTS status_pgto TEXT DEFAULT 'pendente';
ALTER TABLE manutencao_vendas ADD COLUMN IF NOT EXISTS status_pgto TEXT DEFAULT 'pendente';
ALTER TABLE reservations      ADD COLUMN IF NOT EXISTS status_pgto TEXT DEFAULT 'pendente';
ALTER TABLE planos_aula       ADD COLUMN IF NOT EXISTS status_pgto TEXT DEFAULT 'pendente';

-- Forma de Pagamento (pix / debito / credito / boleto)
ALTER TABLE bar_vendas        ADD COLUMN IF NOT EXISTS forma_pgto TEXT;
ALTER TABLE manutencao_vendas ADD COLUMN IF NOT EXISTS forma_pgto TEXT;
ALTER TABLE reservations      ADD COLUMN IF NOT EXISTS forma_pgto TEXT;
ALTER TABLE planos_aula       ADD COLUMN IF NOT EXISTS forma_pgto TEXT;

-- Participantes de reservas em grupo (array de {nome, percentual})
ALTER TABLE reservations ADD COLUMN IF NOT EXISTS participantes JSONB DEFAULT '[]';
