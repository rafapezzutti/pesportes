-- ================================================================
-- Migração: Professores, Planos de Aula e Reservas de Aula
-- Execute no painel SQL do Neon
-- ================================================================

-- 1. Campo "aulas" em estabelecimentos
ALTER TABLE establishments
  ADD COLUMN IF NOT EXISTS aulas BOOLEAN NOT NULL DEFAULT FALSE;

-- 2. Tabela de Professores
CREATE TABLE IF NOT EXISTS professores (
  id               SERIAL PRIMARY KEY,
  est_id           INTEGER REFERENCES establishments(id) ON DELETE CASCADE,
  nome             TEXT    NOT NULL,
  cpf              TEXT,
  data_nascimento  DATE,
  email            TEXT,
  telefone         TEXT,
  valor_hora_avulso NUMERIC(10,2) DEFAULT 0,
  ativo            BOOLEAN NOT NULL DEFAULT TRUE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_professores_est_id ON professores(est_id);

-- 3. Tabela de Planos de Aula (recorrência + pacotes)
--    tipo_plano: 'avulso' | 'mensal' | 'trimestral' | 'semestral'
--    recorrencia: 'nenhuma' | 'semanal' | 'quinzenal' | 'mensal'
--    dias_semana: array de dias (ex: ['seg','qua'])
CREATE TABLE IF NOT EXISTS planos_aula (
  id              SERIAL PRIMARY KEY,
  est_id          INTEGER REFERENCES establishments(id) ON DELETE CASCADE,
  professor_id    INTEGER REFERENCES professores(id) ON DELETE SET NULL,
  nome_aluno      TEXT    NOT NULL,
  telefone_aluno  TEXT,
  email_aluno     TEXT,
  tipo_plano      TEXT    NOT NULL DEFAULT 'avulso',  -- avulso | mensal | trimestral | semestral
  valor           NUMERIC(10,2) NOT NULL DEFAULT 0,
  recorrencia     TEXT    NOT NULL DEFAULT 'nenhuma', -- nenhuma | semanal | quinzenal | mensal
  dias_semana     TEXT[]  DEFAULT '{}',               -- ['seg','qua','sex']
  horario_inicio  TEXT,                               -- '08:00'
  horario_fim     TEXT,                               -- '09:00'
  data_inicio     DATE    NOT NULL DEFAULT CURRENT_DATE,
  data_fim        DATE,
  observacoes     TEXT,
  status          TEXT    NOT NULL DEFAULT 'ativo',   -- ativo | cancelado | concluido
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_planos_aula_est_id       ON planos_aula(est_id);
CREATE INDEX IF NOT EXISTS idx_planos_aula_professor_id ON planos_aula(professor_id);
