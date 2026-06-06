const router = require('express').Router();
const pool   = require('../db/pool');
const { auth, adminOrManager } = require('../middleware/auth');

// Aplica o escopo de estabelecimento conforme o papel do usuário
function scope(req, params, alias = 'pa') {
  const clauses = [];
  if (req.user.role === 'manager' && req.user.est_ids?.length) {
    params.push(req.user.est_ids);
    clauses.push(`${alias}.est_id = ANY($${params.length})`);
  } else if (req.user.role === 'simples' && req.user.est_id) {
    params.push(req.user.est_id);
    clauses.push(`${alias}.est_id = $${params.length}`);
  }
  return clauses;
}

// GET /api/repasse?estId=&from=&to=&status=
// Retorna, por professor, o total de planos no período e o repasse devido (% do plano).
router.get('/', auth, adminOrManager, async (req, res) => {
  const { estId, from, to, status } = req.query;
  const params = [];
  const where = scope(req, params);

  where.push(`pa.professor_id IS NOT NULL`);
  if (estId) { params.push(estId); where.push(`pa.est_id = $${params.length}`); }
  if (from)  { params.push(from);  where.push(`pa.data_inicio >= $${params.length}`); }
  if (to)    { params.push(to);    where.push(`pa.data_inicio <= $${params.length}`); }
  if (status === 'pago')      where.push(`pa.repasse_pago = TRUE`);
  if (status === 'pendente')  where.push(`pa.repasse_pago = FALSE`);

  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';

  try {
    const { rows } = await pool.query(
      `SELECT p.id AS professor_id, p.nome, p.percentual_repasse,
              COUNT(pa.id)::int                                   AS qtd_planos,
              COALESCE(SUM(pa.valor),0)                           AS total_planos,
              COALESCE(SUM(pa.valor * p.percentual_repasse/100),0) AS repasse_devido,
              COALESCE(SUM(pa.valor) FILTER (WHERE pa.repasse_pago),0)        AS total_pago,
              COALESCE(SUM(pa.valor) FILTER (WHERE NOT pa.repasse_pago),0)    AS total_pendente
       FROM professores p
       JOIN planos_aula pa ON pa.professor_id = p.id
       ${whereSql}
       GROUP BY p.id, p.nome, p.percentual_repasse
       ORDER BY p.nome`,
      params
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao calcular repasse' });
  }
});

// GET /api/repasse/:professorId/detalhe?from=&to= — planos do professor
router.get('/:professorId/detalhe', auth, adminOrManager, async (req, res) => {
  const { from, to } = req.query;
  const params = [req.params.professorId];
  const where = ['pa.professor_id = $1'];
  scope(req, params).forEach(c => where.push(c));
  if (from) { params.push(from); where.push(`pa.data_inicio >= $${params.length}`); }
  if (to)   { params.push(to);   where.push(`pa.data_inicio <= $${params.length}`); }

  try {
    const { rows } = await pool.query(
      `SELECT pa.*, p.percentual_repasse,
              (pa.valor * p.percentual_repasse/100) AS repasse
       FROM planos_aula pa JOIN professores p ON p.id = pa.professor_id
       WHERE ${where.join(' AND ')}
       ORDER BY pa.data_inicio DESC`,
      params
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao buscar detalhe' });
  }
});

// PATCH /api/repasse/marcar — marca planos como pagos
// body: { plano_ids: [..] }  ou  { professor_id, from, to }
router.patch('/marcar', auth, adminOrManager, async (req, res) => {
  const { plano_ids, professor_id, from, to } = req.body;
  try {
    if (Array.isArray(plano_ids) && plano_ids.length) {
      await pool.query(
        `UPDATE planos_aula SET repasse_pago = TRUE, repasse_pago_em = NOW() WHERE id = ANY($1)`,
        [plano_ids]
      );
    } else if (professor_id) {
      const params = [professor_id];
      let sql = `UPDATE planos_aula SET repasse_pago = TRUE, repasse_pago_em = NOW()
                 WHERE professor_id = $1 AND repasse_pago = FALSE`;
      if (from) { params.push(from); sql += ` AND data_inicio >= $${params.length}`; }
      if (to)   { params.push(to);   sql += ` AND data_inicio <= $${params.length}`; }
      await pool.query(sql, params);
    } else {
      return res.status(400).json({ error: 'Informe plano_ids ou professor_id' });
    }
    res.json({ message: 'Repasse marcado como pago' });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao marcar repasse' });
  }
});

module.exports = router;
