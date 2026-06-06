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

// GET /api/expenses?estId=&from=&to=&pago=
router.get('/', auth, adminOrManager, async (req, res) => {
  const { estId, from, to, pago } = req.query;
  const params = [];
  const where = scope(req, params);
  if (estId) { params.push(estId); where.push(`est_id = $${params.length}`); }
  if (from)  { params.push(from);  where.push(`vencimento >= $${params.length}`); }
  if (to)    { params.push(to);    where.push(`vencimento <= $${params.length}`); }
  if (pago === 'true')  where.push('pago = TRUE');
  if (pago === 'false') where.push('pago = FALSE');
  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
  try {
    const { rows } = await pool.query(
      `SELECT e.*, est.name AS est_name FROM expenses e
       LEFT JOIN establishments est ON est.id = e.est_id
       ${whereSql} ORDER BY vencimento DESC`, params
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: 'Erro ao listar despesas' }); }
});

// POST /api/expenses
router.post('/', auth, adminOrManager, async (req, res) => {
  const { est_id, categoria, descricao, valor, vencimento, pago, pago_em, recorrencia, observacoes } = req.body;
  if (!vencimento) return res.status(400).json({ error: 'Vencimento é obrigatório' });
  try {
    const { rows } = await pool.query(
      `INSERT INTO expenses (est_id, categoria, descricao, valor, vencimento, pago, pago_em, recorrencia, observacoes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [est_id || null, categoria || 'outro', descricao || null, valor || 0, vencimento,
       !!pago, pago_em || null, recorrencia || 'nenhuma', observacoes || null]
    );
    res.status(201).json(rows[0]);
  } catch (err) { res.status(500).json({ error: 'Erro ao criar despesa' }); }
});

// PUT /api/expenses/:id
router.put('/:id', auth, adminOrManager, async (req, res) => {
  const { est_id, categoria, descricao, valor, vencimento, pago, pago_em, recorrencia, observacoes } = req.body;
  try {
    const { rows } = await pool.query(
      `UPDATE expenses SET est_id=$1, categoria=$2, descricao=$3, valor=$4, vencimento=$5,
         pago=$6, pago_em=$7, recorrencia=$8, observacoes=$9 WHERE id=$10 RETURNING *`,
      [est_id || null, categoria || 'outro', descricao || null, valor || 0, vencimento,
       !!pago, pago_em || null, recorrencia || 'nenhuma', observacoes || null, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Despesa não encontrada' });
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: 'Erro ao atualizar despesa' }); }
});

// DELETE /api/expenses/:id
router.delete('/:id', auth, adminOrManager, async (req, res) => {
  try {
    await pool.query('DELETE FROM expenses WHERE id=$1', [req.params.id]);
    res.json({ message: 'Despesa excluída' });
  } catch (err) { res.status(500).json({ error: 'Erro ao excluir despesa' }); }
});

module.exports = router;
