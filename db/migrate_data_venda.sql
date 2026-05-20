-- Adiciona campo de data nas vendas de Bar e Manutenção
ALTER TABLE bar_vendas        ADD COLUMN IF NOT EXISTS data_venda DATE NOT NULL DEFAULT CURRENT_DATE;
ALTER TABLE manutencao_vendas ADD COLUMN IF NOT EXISTS data_venda DATE NOT NULL DEFAULT CURRENT_DATE;
