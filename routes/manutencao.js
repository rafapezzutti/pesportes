const router = require('express').Router();
const pool   = require('../db/pool');
const { auth, adminOrManager } = require('../middleware/auth');

// GET /api/manutencao?estId=&clienteNome=
router.get('/', auth, async (req, res) => {
  try {
    const { estId, clienteNome } = req.query;
    const clauses = [];
    const params  = [];

    if (req.user.role === 'manager' && req.user.est_ids?.length) {
      clauses.push(`est_id = ANY($${params.length + 1})`);
      params.push(req.user.est_ids);
    } else if (req.user.role === 'simples' && req.user.est_id) {
      clauses.push(`est_id = $${params.length + 1}`);
      params.push(req.user.est_id);
    }

    if (estId)       { clauses.push(`est_id = $${params.length + 1}`);        params.push(estId); }
    if (clienteNome) { clauses.push(`cliente_nome ILIKE $${params.length+1}`); params.push(`%${clienteNome}%`); }

    const where = clauses.length ? 'WHERE ' + clauses.join(' AND ') : '';
    const { rows } = await pool.query(
      `SELECT m.*, e.name AS est_name
       FROM manutencao_vendas m
       LEFT JOIN establishments e ON m.est_id = e.id
       ${where}
       ORDER BY m.data_venda DESC, m.created_at DESC`,
      params
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao listar manutenções' });
  }
});

// POST /api/manutencao
router.post('/', auth, adminOrManager, async (req, res) => {
  const { est_id, cliente_nome, cliente_ref, itens, observacoes, data_venda } = req.body;
  if (!cliente_nome) return res.status(400).json({ error: 'Nome do cliente é obrigatório' });
  if (!itens || !itens.length) return res.status(400).json({ error: 'Adicione ao menos um item' });

  const total = itens.reduce((s, i) => s + (Number(i.quantidade) * Number(i.valor_unitario)), 0);
  const dataFinal = data_venda || new Date().toISOString().split('T')[0];

  try {
    const { rows } = await pool.query(
      `INSERT INTO manutencao_vendas (est_id, cliente_nome, cliente_ref, itens, total, observacoes, data_venda)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [est_id || null, cliente_nome, cliente_ref || 'manual',
       JSON.stringify(itens), total, observacoes || null, dataFinal]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao registrar manutenção' });
  }
});

// DELETE /api/manutencao/:id
router.delete('/:id', auth, adminOrManager, async (req, res) => {
  try {
    await pool.query('DELETE FROM manutencao_vendas WHERE id=$1', [req.params.id]);
    res.json({ message: 'Registro excluído' });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao excluir registro' });
  }
});

module.exports = router;
