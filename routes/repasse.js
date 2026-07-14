const router = require('express').Router();
const pool   = require('../db/pool');
const { auth, adminOrManager } = require('../middleware/auth');

function canView(user) {
  return ['admin','manager','simples','professor'].includes(user.role);
}

// Aplica escopo de est + professor na subquery unificada (alias = 'src')
function scope(req, params) {
  const clauses = [];
  if (req.user.role === 'professor') {
    if (req.user.professor_id) {
      params.push(req.user.professor_id);
      clauses.push(`src.professor_id = $${params.length}`);
    }
    if (req.user.est_id) {
      params.push(req.user.est_id);
      clauses.push(`src.est_id = $${params.length}`);
    }
  } else if (req.user.role === 'manager') {
    const ids = Array.from(new Set([
      ...(req.user.est_ids || []),
      ...(req.user.est_id ? [req.user.est_id] : []),
    ])).map(Number).filter(Boolean);
    if (ids.length) {
      params.push(ids);
      clauses.push(`src.est_id = ANY($${params.length})`);
    }
  } else if (req.user.role === 'simples' && req.user.est_id) {
    params.push(req.user.est_id);
    clauses.push(`src.est_id = $${params.length}`);
  }
  return clauses;
}

// Subquery que une planos_aula + reservations por professor
const SRC_UNION = `(
  SELECT id, professor_id, est_id, valor, data_inicio AS data, repasse_pago, 'plano' AS origem
  FROM planos_aula
  WHERE professor_id IS NOT NULL
  UNION ALL
  SELECT id, professor_id, est_id, total AS valor, date AS data,
         COALESCE(repasse_pago, FALSE) AS repasse_pago, 'reserva' AS origem
  FROM reservations
  WHERE professor_id IS NOT NULL AND total > 0
) src`;

// GET /api/repasse?from=&to=&estId=&status=
router.get('/', auth, async (req, res) => {
  if (!canView(req.user)) return res.status(403).json({ error: 'Sem permissão' });
  const { estId, from, to, status } = req.query;
  const params = [];
  const where  = scope(req, params);

  if (estId)  { params.push(estId); where.push(`src.est_id = $${params.length}`); }
  if (from)   { params.push(from);  where.push(`src.data >= $${params.length}`); }
  if (to)     { params.push(to);    where.push(`src.data <= $${params.length}`); }
  if (status === 'pago')     where.push(`src.repasse_pago = TRUE`);
  if (status === 'pendente') where.push(`src.repasse_pago = FALSE`);

  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';

  try {
    const { rows } = await pool.query(
      `SELECT p.id AS professor_id, p.nome, p.percentual_repasse,
              COUNT(src.id)::int                                      AS qtd_planos,
              COALESCE(SUM(src.valor),0)                              AS total_planos,
              COALESCE(SUM(src.valor * p.percentual_repasse/100),0)   AS repasse_devido,
              COALESCE(SUM(src.valor) FILTER (WHERE src.repasse_pago),0)      AS total_pago,
              COALESCE(SUM(src.valor) FILTER (WHERE NOT src.repasse_pago),0)  AS total_pendente
       FROM professores p
       JOIN ${SRC_UNION} ON src.professor_id = p.id
       ${whereSql}
       GROUP BY p.id, p.nome, p.percentual_repasse
       ORDER BY p.nome`,
      params
    );
    res.json(rows);
  } catch (err) {
    console.error('[GET /repasse]', err);
    res.status(500).json({ error: 'Erro ao calcular repasse' });
  }
});

// GET /api/repasse/:professorId/detalhe?from=&to=
router.get('/:professorId/detalhe', auth, async (req, res) => {
  if (!canView(req.user)) return res.status(403).json({ error: 'Sem permissão' });
  if (req.user.role === 'professor' && req.user.professor_id &&
      String(req.user.professor_id) !== String(req.params.professorId)) {
    return res.status(403).json({ error: 'Sem permissão' });
  }
  const { from, to } = req.query;

  try {
    const params1 = [req.params.professorId];
    const w1 = ['pa.professor_id = $1'];
    if (from) { params1.push(from); w1.push(`pa.data_inicio >= $${params1.length}`); }
    if (to)   { params1.push(to);   w1.push(`pa.data_inicio <= $${params1.length}`); }
    if (req.user.role === 'manager') {
      const ids = Array.from(new Set([...(req.user.est_ids||[]),...(req.user.est_id?[req.user.est_id]:[])]))
        .map(Number).filter(Boolean);
      if (ids.length) { params1.push(ids); w1.push(`pa.est_id = ANY($${params1.length})`); }
    } else if (req.user.role === 'simples' && req.user.est_id) {
      params1.push(req.user.est_id); w1.push(`pa.est_id = $${params1.length}`);
    } else if (req.user.role === 'professor' && req.user.est_id) {
      params1.push(req.user.est_id); w1.push(`pa.est_id = $${params1.length}`);
    }

    const params2 = [req.params.professorId];
    const w2 = ['r.professor_id = $1', 'r.total > 0'];
    if (from) { params2.push(from); w2.push(`r.date >= $${params2.length}`); }
    if (to)   { params2.push(to);   w2.push(`r.date <= $${params2.length}`); }
    if (req.user.role === 'manager') {
      const ids = Array.from(new Set([...(req.user.est_ids||[]),...(req.user.est_id?[req.user.est_id]:[])]))
        .map(Number).filter(Boolean);
      if (ids.length) { params2.push(ids); w2.push(`r.est_id = ANY($${params2.length})`); }
    } else if (req.user.role === 'simples' && req.user.est_id) {
      params2.push(req.user.est_id); w2.push(`r.est_id = $${params2.length}`);
    } else if (req.user.role === 'professor' && req.user.est_id) {
      params2.push(req.user.est_id); w2.push(`r.est_id = $${params2.length}`);
    }

    const [planos, reservas, prof] = await Promise.all([
      pool.query(
        `SELECT pa.id, pa.nome_aluno AS descricao, pa.data_inicio AS data, pa.valor,
                pa.repasse_pago, pa.repasse_pago_em, p.percentual_repasse,
                (pa.valor * p.percentual_repasse/100) AS repasse, 'plano' AS origem
         FROM planos_aula pa JOIN professores p ON p.id = pa.professor_id
         WHERE ${w1.join(' AND ')} ORDER BY pa.data_inicio DESC`,
        params1
      ),
      pool.query(
        `SELECT r.id, r.client_name AS descricao, r.date AS data, r.total AS valor,
                COALESCE(r.repasse_pago,FALSE) AS repasse_pago, r.repasse_pago_em,
                p.percentual_repasse,
                (r.total * p.percentual_repasse/100) AS repasse, 'reserva' AS origem
         FROM reservations r JOIN professores p ON p.id = r.professor_id
         WHERE ${w2.join(' AND ')} ORDER BY r.date DESC`,
        params2
      ),
      pool.query(`SELECT nome, percentual_repasse FROM professores WHERE id=$1`, [req.params.professorId]),
    ]);

    res.json({
      professor: prof.rows[0] || null,
      planos:    planos.rows,
      reservas:  reservas.rows,
    });
  } catch (err) {
    console.error('[GET /repasse/:id/detalhe]', err);
    res.status(500).json({ error: 'Erro ao buscar detalhe' });
  }
});

// PATCH /api/repasse/marcar — marca planos + reservas como pagos
router.patch('/marcar', auth, adminOrManager, async (req, res) => {
  const { plano_ids, reserva_ids, professor_id, from, to } = req.body;
  try {
    if (Array.isArray(plano_ids) && plano_ids.length) {
      await pool.query(
        `UPDATE planos_aula SET repasse_pago=TRUE, repasse_pago_em=NOW() WHERE id=ANY($1)`,
        [plano_ids]
      );
    }
    if (Array.isArray(reserva_ids) && reserva_ids.length) {
      await pool.query(
        `UPDATE reservations SET repasse_pago=TRUE, repasse_pago_em=NOW() WHERE id=ANY($1)`,
        [reserva_ids]
      );
    }
    if (!plano_ids && !reserva_ids && professor_id) {
      const p = [professor_id];
      let sql1 = `UPDATE planos_aula SET repasse_pago=TRUE, repasse_pago_em=NOW() WHERE professor_id=$1 AND repasse_pago=FALSE`;
      let sql2 = `UPDATE reservations SET repasse_pago=TRUE, repasse_pago_em=NOW() WHERE professor_id=$1 AND COALESCE(repasse_pago,FALSE)=FALSE AND total>0`;
      if (from) { p.push(from); sql1 += ` AND data_inicio>=$${p.length}`; sql2 += ` AND date>=$${p.length}`; }
      if (to)   { p.push(to);   sql1 += ` AND data_inicio<=$${p.length}`; sql2 += ` AND date<=$${p.length}`; }
      await Promise.all([pool.query(sql1, p), pool.query(sql2, p)]);
    }
    res.json({ message: 'Repasse marcado como pago' });
  } catch (err) {
    console.error('[PATCH /repasse/marcar]', err);
    res.status(500).json({ error: 'Erro ao marcar repasse' });
  }
});

module.exports = router;
