-- Migração: configuração WhatsApp por estabelecimento
-- Executar no banco PostgreSQL do pesportes-app

CREATE TABLE IF NOT EXISTS whatsapp_config (
  id           SERIAL PRIMARY KEY,
  instance_name TEXT NOT NULL DEFAULT 'pesportes',
  connected    BOOLEAN NOT NULL DEFAULT false,
  phone_number TEXT,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Garante que existe ao menos um registro
INSERT INTO whatsapp_config (instance_name, connected)
VALUES ('pesportes', false)
ON CONFLICT DO NOTHING;
