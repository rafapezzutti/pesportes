const router = require('express').Router();
const pool   = require('../db/pool');
const { auth, adminOrManager } = require('../middleware/auth');

// Retorna lista combinada de clientes (para dropdown)
router.get('/clientes', auth, async (req, res) => {
  try {
    const clauses = [];
    const params  = [];

    // Filtro por estabelecimento se for gerente/simples
    let estFilter = '';
    if (req.user.role === 'manager' && req.user.est_ids?.length) {
      estFilter = `AND est_id = ANY($1)`;
      params.push(req.user.est_ids);
    } else if (req.user.role === 'simples' && req.user.est_id) {
      estFilter = `AND est_id = $1`;
      params.push(req.user.est_id);
    }

    const pidx = params.length ? `$${params.length}` : null;

    const { rows } = await pool.query(`
      SELECT DISTINCT nome FROM (
        SELECT name AS nome FROM public_users
        UNION
        SELECT client_name AS nome FROM reservations WHERE client_name IS NOT NULL ${estFilter ? estFilter.replace('est_id', 'est_id') : ''}
        UNION
        SELECT nome_aluno AS nome FROM planos_aula WHERE nome_aluno IS NOT NULL ${estFilter ? estFilter.replace('est_id', 'est_id') : ''}
        UNION
        SELECT cliente_nome AS nome FROM bar_vendas WHERE cliente_nome IS NOT NULL ${estFilter ? estFilter.replace('est_id', 'est_id') : ''}
        UNION
        SELECT cliente_nome AS nome FROM manutencao_vendas WHERE cliente_nome IS NOT NULL ${estFilter ? estFilter.replace('est_id', 'est_id') : ''}
      ) AS t
      WHERE nome IS NOT NULL AND nome != ''
      ORDER BY nome
    `, params);

    res.json(rows.map(r => r.nome));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao listar clientes' });
  }
});

// GET /api/bar?estId=&clienteNome=
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
      `SELECT b.*, e.name AS est_name
       FROM bar_vendas b
       LEFT JOIN establishments e ON b.est_id = e.id
       ${where}
       ORDER BY b.created_at DESC`,
      params
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao listar vendas do bar' });
  }
});

// POST /api/bar
router.post('/', auth, adminOrManager, async (req, res) => {
  const { est_id, cliente_nome, cliente_ref, itens, observacoes } = req.body;
  if (!cliente_nome) return res.status(400).json({ error: 'Nome do cliente é obrigatório' });
  if (!itens || !itens.length) return res.status(400).json({ error: 'Adicione ao menos um item' });

  const total = itens.reduce((s, i) => s + (Number(i.quantidade) * Number(i.valor_unitario)), 0);

  try {
    const { rows } = await pool.query(
      `INSERT INTO bar_vendas (est_id, cliente_nome, cliente_ref, itens, total, observacoes)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [est_id || null, cliente_nome, cliente_ref || 'manual',
       JSON.stringify(itens), total, observacoes || null]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao registrar venda do bar' });
  }
});

// DELETE /api/bar/:id
router.delete('/:id', auth, adminOrManager, async (req, res) => {
  try {
    await pool.query('DELETE FROM bar_vendas WHERE id=$1', [req.params.id]);
    res.json({ message: 'Venda excluída' });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao excluir venda' });
  }
});

module.exports = router;
