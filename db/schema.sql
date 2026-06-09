-- ================================================================
-- P. Soluções para Esportes & Reservas — Schema PostgreSQL
-- Execute no Neon SQL Editor ou via psql
-- ================================================================

-- Estabelecimentos
CREATE TABLE IF NOT EXISTS establishments (
  id              SERIAL PRIMARY KEY,
  name            TEXT NOT NULL,
  responsible     TEXT NOT NULL,
  cpf_cnpj        TEXT,
  street          TEXT,
  number          TEXT,
  complement      TEXT,
  cep             TEXT,
  city            TEXT,
  state           VARCHAR(2),
  phone           TEXT,
  email           TEXT,
  photos          TEXT[]  DEFAULT '{}',
  main_photo      TEXT,
  operating_hours JSONB   NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Pontos / Espaços
CREATE TABLE IF NOT EXISTS points (
  id             SERIAL PRIMARY KEY,
  est_id         INTEGER NOT NULL REFERENCES establishments(id) ON DELETE CASCADE,
  type           TEXT NOT NULL,
  name           TEXT NOT NULL,
  price_per_hour NUMERIC(10,2) NOT NULL,
  custom_hours   JSONB,
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

-- Usuários do CRM (admin / gerente)
CREATE TABLE IF NOT EXISTS crm_users (
  id            SERIAL PRIMARY KEY,
  name          TEXT NOT NULL,
  email         TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'manager'
                  CHECK (role IN ('admin', 'manager')),
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- Usuários Públicos (clientes do marketplace)
CREATE TABLE IF NOT EXISTS public_users (
  id            SERIAL PRIMARY KEY,
  name          TEXT NOT NULL,
  cpf           TEXT,
  email         TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  reset_token   TEXT,
  reset_expires TIMESTAMPTZ,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- Reservas
CREATE TABLE IF NOT EXISTS reservations (
  id         SERIAL PRIMARY KEY,
  point_id   INTEGER NOT NULL REFERENCES points(id),
  est_id     INTEGER NOT NULL REFERENCES establishments(id),
  user_id    INTEGER NOT NULL REFERENCES public_users(id),
  date       DATE NOT NULL,
  start_time TEXT NOT NULL,
  end_time   TEXT NOT NULL,
  hours      INTEGER NOT NULL,
  total      NUMERIC(10,2) NOT NULL,
  status     TEXT NOT NULL DEFAULT 'confirmed'
               CHECK (status IN ('confirmed', 'cancelled', 'completed')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Índices
CREATE INDEX IF NOT EXISTS idx_res_date   ON reservations(date);
CREATE INDEX IF NOT EXISTS idx_res_point  ON reservations(point_id);
CREATE INDEX IF NOT EXISTS idx_res_user   ON reservations(user_id);
CREATE INDEX IF NOT EXISTS idx_res_status ON reservations(status);
CREATE INDEX IF NOT EXISTS idx_pts_est    ON points(est_id);
