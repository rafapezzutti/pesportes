-- Migration: profissionais_ef
-- Cria tabela de profissionais de educação física e ajusta tabelas relacionadas

CREATE TABLE IF NOT EXISTS profissionais_ef (
  id SERIAL PRIMARY KEY,
  nome TEXT NOT NULL,
  cref TEXT,
  especialidade TEXT,
  bio TEXT,
  foto TEXT,
  phone TEXT,
  email TEXT,
  site TEXT,
  street TEXT,
  number TEXT,
  complement TEXT,
  cep TEXT,
  city TEXT,
  state TEXT,
  valor_hora NUMERIC(10,2) DEFAULT 0,
  aceita_avulso BOOLEAN DEFAULT TRUE,
  aceita_mensal BOOLEAN DEFAULT FALSE,
  marketplace_visible BOOLEAN DEFAULT FALSE,
  operating_hours JSONB DEFAULT '{}',
  ativo BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE crm_users
  ADD COLUMN IF NOT EXISTS profissional_id INTEGER REFERENCES profissionais_ef(id) ON DELETE SET NULL;

ALTER TABLE planos_aula
  ADD COLUMN IF NOT EXISTS profissional_ef_id INTEGER REFERENCES profissionais_ef(id) ON DELETE SET NULL;

ALTER TABLE profissionais_ef ADD COLUMN IF NOT EXISTS foto_x INTEGER DEFAULT 50;
ALTER TABLE profissionais_ef ADD COLUMN IF NOT EXISTS foto_y INTEGER DEFAULT 30;
