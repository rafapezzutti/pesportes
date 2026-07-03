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

// GET /api/rankings
router.get('/', auth, adminOrManager, async (req, res) => {
  const { estId, status } = req.query;
  const params = [];
  const where = scope(req, params);
  if (estId) { params.push(estId); where.push(`est_id = $${params.length}`); }
  if (status) { params.push(status); where.push(`status = $${params.length}`); }
  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
  try {
    const { rows } = await pool.query(
      `SELECT rk.*, e.name AS est_name
       FROM rankings rk
       LEFT JOIN establishments e ON e.id = rk.est_id
       ${whereSql} ORDER BY rk.data_inicio DESC`,
      params
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: 'Erro ao listar rankings' }); }
});

// POST /api/rankings
router.post('/', auth, adminOrManager, async (req, res) => {
  const { est_id, nome_aluno, telefone_aluno, email_aluno, valor, data_inicio, data_fim, observacoes } = req.body;
  if (!nome_aluno) return res.status(400).json({ error: 'Nome do aluno é obrigatório' });
  if (!valor)      return res.status(400).json({ error: 'Valor é obrigatório' });
  try {
    const { rows } = await pool.query(
      `INSERT INTO rankings (est_id, nome_aluno, telefone_aluno, email_aluno, valor, data_inicio, data_fim, observacoes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [est_id || null, nome_aluno, telefone_aluno || null, email_aluno || null,
       Number(valor), data_inicio || null, data_fim || null, observacoes || null]
    );
    res.status(201).json(rows[0]);
  } catch (err) { res.status(500).json({ error: 'Erro ao criar ranking' }); }
});

// PUT /api/rankings/:id
router.put('/:id', auth, adminOrManager, async (req, res) => {
  const { est_id, nome_aluno, telefone_aluno, email_aluno, valor, data_inicio, data_fim,
          observacoes, status, status_pgto, forma_pgto } = req.body;
  try {
    const { rows } = await pool.query(
      `UPDATE rankings SET
         est_id=$1, nome_aluno=$2, telefone_aluno=$3, email_aluno=$4,
         valor=$5, data_inicio=$6, data_fim=$7, observacoes=$8,
         status=$9, status_pgto=$10, forma_pgto=$11, updated_at=NOW()
       WHERE id=$12 RETURNING *`,
      [est_id || null, nome_aluno, telefone_aluno || null, email_aluno || null,
       Number(valor), data_inicio || null, data_fim || null, observacoes || null,
       status || 'ativo', status_pgto || 'pendente', forma_pgto || null, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Ranking não encontrado' });
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: 'Erro ao atualizar ranking' }); }
});

// DELETE /api/rankings/:id
router.delete('/:id', auth, adminOrManager, async (req, res) => {
  try {
    await pool.query('DELETE FROM rankings WHERE id=$1', [req.params.id]);
    res.json({ message: 'Ranking excluído' });
  } catch (err) { res.status(500).json({ error: 'Erro ao excluir ranking' }); }
});

module.exports = router;
