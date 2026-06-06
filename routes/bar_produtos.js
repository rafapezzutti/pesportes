const router = require('express').Router();
const pool   = require('../db/pool');
const { auth, adminOrManager } = require('../middleware/auth');

function scope(req, params) {
  const clauses = [];
  if (req.user.role === 'manager' && req.user.est_ids?.length) {
    params.push(req.user.est_ids); clauses.push(`est_id = ANY($${params.length})`);
  } else if (req.user.role === 'simples' && req.user.est_id) {
    params.push(req.user.est_id); clauses.push(`est_id = $${params.length}`);
  }
  return clauses;
}

// GET /api/bar-produtos?estId=
router.get('/', auth, async (req, res) => {
  const { estId } = req.query;
  const params = [];
  const where = scope(req, params);
  if (estId) { params.push(estId); where.push(`est_id = $${params.length}`); }
  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
  try {
    const { rows } = await pool.query(
      `SELECT p.*, e.name AS est_name FROM bar_produtos p
       LEFT JOIN establishments e ON e.id = p.est_id
       ${whereSql} ORDER BY p.nome`, params
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: 'Erro ao listar produtos' }); }
});

// POST /api/bar-produtos
router.post('/', auth, adminOrManager, async (req, res) => {
  const { est_id, nome, preco, estoque, estoque_min } = req.body;
  if (!nome) return res.status(400).json({ error: 'Nome é obrigatório' });
  try {
    const { rows } = await pool.query(
      `INSERT INTO bar_produtos (est_id, nome, preco, estoque, estoque_min)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [est_id || null, nome, preco || 0, estoque || 0, estoque_min || 0]
    );
    res.status(201).json(rows[0]);
  } catch (err) { res.status(500).json({ error: 'Erro ao criar produto' }); }
});

// PUT /api/bar-produtos/:id
router.put('/:id', auth, adminOrManager, async (req, res) => {
  const { est_id, nome, preco, estoque, estoque_min, ativo } = req.body;
  try {
    const { rows } = await pool.query(
      `UPDATE bar_produtos SET est_id=$1, nome=$2, preco=$3, estoque=$4, estoque_min=$5,
         ativo=$6, updated_at=NOW() WHERE id=$7 RETURNING *`,
      [est_id || null, nome, preco || 0, estoque || 0, estoque_min || 0, ativo !== false, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Produto não encontrado' });
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: 'Erro ao atualizar produto' }); }
});

// PATCH /api/bar-produtos/:id/estoque — ajuste rápido (entrada/saída)
router.patch('/:id/estoque', auth, adminOrManager, async (req, res) => {
  const delta = Number(req.body.delta) || 0;
  try {
    const { rows } = await pool.query(
      'UPDATE bar_produtos SET estoque = estoque + $1, updated_at=NOW() WHERE id=$2 RETURNING *',
      [delta, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Produto não encontrado' });
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: 'Erro ao ajustar estoque' }); }
});

// DELETE /api/bar-produtos/:id
router.delete('/:id', auth, adminOrManager, async (req, res) => {
  try {
    await pool.query('DELETE FROM bar_produtos WHERE id=$1', [req.params.id]);
    res.json({ message: 'Produto excluído' });
  } catch (err) { res.status(500).json({ error: 'Erro ao excluir produto' }); }
});

module.exports = router;
