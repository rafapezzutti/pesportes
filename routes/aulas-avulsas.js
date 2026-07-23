const router = require('express').Router();
const pool   = require('../db/pool');
const { auth, adminOrManager } = require('../middleware/auth');

function canView(user) {
  return ['admin','manager','simples','professor'].includes(user.role);
}

// Scope por estabelecimento + professor
function scopeWhere(req, params, alias = 'aa') {
  const clauses = [];
  if (req.user.role === 'professor' && req.user.professor_id) {
    params.push(req.user.professor_id);
    clauses.push(`${alias}.professor_id = $${params.length}`);
  }
  if (req.user.role === 'manager') {
    const ids = Array.from(new Set([
      ...(req.user.est_ids || []),
      ...(req.user.est_id ? [req.user.est_id] : []),
    ])).map(Number).filter(Boolean);
    if (ids.length) { params.push(ids); clauses.push(`${alias}.est_id = ANY($${params.length})`); }
  } else if (['simples'].includes(req.user.role) && req.user.est_id) {
    params.push(req.user.est_id);
    clauses.push(`${alias}.est_id = $${params.length}`);
  }
  return clauses;
}

// GET /api/aulas-avulsas?from=&to=&estId=&professorId=
router.get('/', auth, async (req, res) => {
  if (!canView(req.user)) return res.status(403).json({ error: 'Sem permissão' });
  const { from, to, estId, professorId } = req.query;
  const params = [];
  const where = scopeWhere(req, params);

  if (estId)       { params.push(estId);       where.push(`aa.est_id = $${params.length}`); }
  if (professorId) { params.push(professorId); where.push(`aa.professor_id = $${params.length}`); }
  if (from)        { params.push(from);        where.push(`aa.data >= $${params.length}`); }
  if (to)          { params.push(to);          where.push(`aa.data <= $${params.length}`); }

  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
  try {
    const { rows } = await pool.query(
      `SELECT aa.*, p.nome AS professor_nome, p.percentual_repasse,
              pt.name AS ponto_nome, e.name AS est_nome
       FROM aulas_avulsas aa
       LEFT JOIN professores p  ON p.id  = aa.professor_id
       LEFT JOIN points     pt  ON pt.id = aa.ponto_id
       LEFT JOIN establishments e ON e.id = aa.est_id
       ${whereSql}
       ORDER BY aa.data DESC, aa.hora DESC`,
      params
    );
    res.json(rows);
  } catch (err) {
    console.error('[GET /aulas-avulsas]', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/aulas-avulsas
router.post('/', auth, async (req, res) => {
  if (!canView(req.user)) return res.status(403).json({ error: 'Sem permissão' });
  const { professor_id, ponto_id, aluno_nome, data, hora, valor, obs } = req.body;

  // Resolve est_id por role
  let est_id = req.body.est_id;
  if (['simples', 'professor'].includes(req.user.role)) {
    est_id = req.user.est_id;
  } else if (req.user.role === 'manager') {
    est_id = req.body.est_id || req.user.est_id || req.user.est_ids?.[0] || null;
  }

  if (!data || !aluno_nome || valor == null)
    return res.status(400).json({ error: 'data, aluno_nome e valor são obrigatórios' });
  if (!est_id)
    return res.status(400).json({ error: 'Estabelecimento é obrigatório' });
  try {
    const { rows } = await pool.query(
      `INSERT INTO aulas_avulsas (est_id, professor_id, ponto_id, aluno_nome, data, hora, valor, obs)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [est_id, professor_id || null, ponto_id || null,
       aluno_nome, data, hora || null, Number(valor), obs || null]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('[POST /aulas-avulsas]', err);
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/aulas-avulsas/:id
router.put('/:id', auth, async (req, res) => {
  if (!canView(req.user)) return res.status(403).json({ error: 'Sem permissão' });
  const { professor_id, ponto_id, aluno_nome, data, hora, valor, obs } = req.body;
  try {
    const { rows } = await pool.query(
      `UPDATE aulas_avulsas
       SET professor_id=$1, ponto_id=$2, aluno_nome=$3, data=$4, hora=$5, valor=$6, obs=$7
       WHERE id=$8 RETURNING *`,
      [professor_id || null, ponto_id || null, aluno_nome, data, hora || null,
       Number(valor), obs || null, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Não encontrado' });
    res.json(rows[0]);
  } catch (err) {
    console.error('[PUT /aulas-avulsas]', err);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/aulas-avulsas/:id
router.delete('/:id', auth, adminOrManager, async (req, res) => {
  try {
    await pool.query('DELETE FROM aulas_avulsas WHERE id=$1', [req.params.id]);
    res.json({ message: 'Excluído' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
