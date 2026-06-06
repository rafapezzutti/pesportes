-- ================================================================
-- Migração: RH — funcionários (CLT/PJ) e controle de ponto
-- Execute: cole no SQL Editor do Neon (ou psql -f). Idempotente.
-- ================================================================

-- Funcionários (CLT) e prestadores (PJ)
CREATE TABLE IF NOT EXISTS employees (
  id              SERIAL PRIMARY KEY,
  est_id          INTEGER REFERENCES establishments(id) ON DELETE CASCADE,
  tipo            TEXT    NOT NULL DEFAULT 'clt',   -- 'clt' | 'pj'
  nome            TEXT    NOT NULL,
  cargo           TEXT,                              -- recepcionista, faxineira, personal, etc.
  cpf_cnpj        TEXT,
  email           TEXT,
  telefone        TEXT,
  salario_base    NUMERIC(10,2) NOT NULL DEFAULT 0, -- p/ PJ: valor mensal do contrato
  encargos        NUMERIC(10,2) NOT NULL DEFAULT 0, -- INSS/FGTS/13/férias (manual)
  beneficios      NUMERIC(10,2) NOT NULL DEFAULT 0, -- VR/VA/plano/etc. (manual)
  vale_transporte NUMERIC(10,2) NOT NULL DEFAULT 0,
  dia_pagamento   INTEGER NOT NULL DEFAULT 5,        -- dia do mês (p/ projeção)
  data_admissao   DATE,
  data_demissao   DATE,
  ativo           BOOLEAN NOT NULL DEFAULT TRUE,
  observacoes     TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_employees_est ON employees(est_id);

-- Registros de ponto (lançamento manual)
CREATE TABLE IF NOT EXISTS ponto_registros (
  id           SERIAL PRIMARY KEY,
  employee_id  INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  data         DATE    NOT NULL,
  entrada      TEXT,                                  -- 'HH:MM'
  saida        TEXT,                                  -- 'HH:MM'
  horas        NUMERIC(5,2) NOT NULL DEFAULT 0,
  tipo         TEXT    NOT NULL DEFAULT 'normal',     -- normal | falta | atestado | folga | ferias
  observacoes  TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (employee_id, data)
);
CREATE INDEX IF NOT EXISTS idx_ponto_emp  ON ponto_registros(employee_id);
CREATE INDEX IF NOT EXISTS idx_ponto_data ON ponto_registros(data);
