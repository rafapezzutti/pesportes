const router = require('express').Router();
const pool   = require('../db/pool');
const { auth, adminOrManager } = require('../middleware/auth');

const SINGLE_EST_ROLES = ['simples', 'professor', 'recepcao', 'profissional'];

function addEstScope(req, clauses, params) {
  if (req.user.role === 'manager') {
    const ids = Array.from(new Set([
      ...(req.user.est_ids || []),
      ...(req.user.est_id ? [req.user.est_id] : []),
    ])).map(Number).filter(Boolean);
    if (ids.length) { clauses.push(`est_id = ANY($${params.length + 1})`); params.push(ids); }
  } else if (SINGLE_EST_ROLES.includes(req.user.role) && req.user.est_id) {
    clauses.push(`est_id = $${params.length + 1}`);
    params.push(req.user.est_id);
  }
}

function estAllowed(req, estId) {
  if (req.user.role === 'admin') return true;
  if (req.user.role === 'manager') {
    const ids = Array.from(new Set([
      ...(req.user.est_ids || []),
      ...(req.user.est_id ? [req.user.est_id] : []),
    ])).map(Number).filter(Boolean);
    return ids.includes(Number(estId));
  }
  return Number(req.user.est_id) === Number(estId);
}

// GET /api/bar-produtos?estId=
router.get('/', auth, async (req, res) => {
  const { estId } = req.query;
  const params = [];
  const clauses = [];
  addEstScope(req, clauses, params);

  // Admin/manager podem filtrar por estId adicional dentro do seu escopo
  if (estId && (req.user.role === 'admin' || req.user.role === 'manager')) {
    if (estAllowed(req, estId)) {
      clauses.push(`est_id = $${params.length + 1}`);
      params.push(estId);
    }
  }

  const whereSql = clauses.length ? 'WHERE ' + clauses.join(' AND ') : '';
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
  if (est_id && !estAllowed(req, est_id)) return res.status(403).json({ error: 'Sem permissão para este estabelecimento' });
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
    // Verifica propriedade
    const { rows: ex } = await pool.query('SELECT est_id FROM bar_produtos WHERE id=$1', [req.params.id]);
    if (!ex.length) return res.status(404).json({ error: 'Produto não encontrado' });
    if (!estAllowed(req, ex[0].est_id)) return res.status(403).json({ error: 'Sem permissão' });

    const { rows } = await pool.query(
      `UPDATE bar_produtos SET est_id=$1, nome=$2, preco=$3, estoque=$4, estoque_min=$5,
         ativo=$6, updated_at=NOW() WHERE id=$7 RETURNING *`,
      [est_id || ex[0].est_id, nome, preco || 0, estoque || 0, estoque_min || 0, ativo !== false, req.params.id]
    );
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: 'Erro ao atualizar produto' }); }
});

// PATCH /api/bar-produtos/:id/estoque — ajuste rápido (entrada/saída)
router.patch('/:id/estoque', auth, adminOrManager, async (req, res) => {
  const delta = Number(req.body.delta) || 0;
  try {
    const { rows: ex } = await pool.query('SELECT est_id FROM bar_produtos WHERE id=$1', [req.params.id]);
    if (!ex.length) return res.status(404).json({ error: 'Produto não encontrado' });
    if (!estAllowed(req, ex[0].est_id)) return res.status(403).json({ error: 'Sem permissão' });

    const { rows } = await pool.query(
      'UPDATE bar_produtos SET estoque = estoque + $1, updated_at=NOW() WHERE id=$2 RETURNING *',
      [delta, req.params.id]
    );
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: 'Erro ao ajustar estoque' }); }
});

// DELETE /api/bar-produtos/:id
router.delete('/:id', auth, adminOrManager, async (req, res) => {
  try {
    const { rows: ex } = await pool.query('SELECT est_id FROM bar_produtos WHERE id=$1', [req.params.id]);
    if (!ex.length) return res.status(404).json({ error: 'Produto não encontrado' });
    if (!estAllowed(req, ex[0].est_id)) return res.status(403).json({ error: 'Sem permissão' });

    await pool.query('DELETE FROM bar_produtos WHERE id=$1', [req.params.id]);
    res.json({ message: 'Produto excluído' });
  } catch (err) { res.status(500).json({ error: 'Erro ao excluir produto' }); }
});

module.exports = router;
