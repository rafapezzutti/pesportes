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
  SELECT pa.id, pa.professor_id, pa.est_id, pa.valor, pa.data_inicio AS data,
         COALESCE(pa.repasse_pago, FALSE) AS repasse_pago, 'plano' AS origem
  FROM planos_aula pa
  WHERE pa.professor_id IS NOT NULL AND COALESCE(pa.status,'ativo') != 'cancelado'
  UNION ALL
  SELECT r.id, r.professor_id, r.est_id, r.total AS valor, r.date AS data,
         COALESCE(r.repasse_pago, FALSE) AS repasse_pago, 'reserva' AS origem
  FROM reservations r
  WHERE r.professor_id IS NOT NULL AND r.total > 0
  UNION ALL
  SELECT av.id, av.professor_id, av.est_id, av.valor, av.data,
         COALESCE(av.repasse_pago, FALSE) AS repasse_pago, 'avulsa' AS origem
  FROM aulas_avulsas av
  WHERE av.professor_id IS NOT NULL
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
              COALESCE(SUM(src.valor * p.percentual_repasse/100) FILTER (WHERE NOT src.repasse_pago),0)  AS total_pendente
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
    res.status(500).json({ error: 'Erro ao calcular repasse: ' + err.message });
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

    const params3 = [req.params.professorId];
    const w3 = ['av.professor_id = $1'];
    if (from) { params3.push(from); w3.push(`av.data >= $${params3.length}`); }
    if (to)   { params3.push(to);   w3.push(`av.data <= $${params3.length}`); }
    if (req.user.role === 'manager') {
      const ids = Array.from(new Set([...(req.user.est_ids||[]),...(req.user.est_id?[req.user.est_id]:[])]))
        .map(Number).filter(Boolean);
      if (ids.length) { params3.push(ids); w3.push(`av.est_id = ANY($${params3.length})`); }
    } else if (req.user.role === 'simples' && req.user.est_id) {
      params3.push(req.user.est_id); w3.push(`av.est_id = $${params3.length}`);
    } else if (req.user.role === 'professor' && req.user.est_id) {
      params3.push(req.user.est_id); w3.push(`av.est_id = $${params3.length}`);
    }

    const [planos, reservas, avulsas, prof] = await Promise.all([
      pool.query(
        `SELECT pa.id, pa.nome_aluno AS descricao, pa.data_inicio AS data, pa.valor,
                pa.repasse_pago, pa.repasse_pago_em, p.percentual_repasse,
                (pa.valor * p.percentual_repasse/100) AS repasse, 'plano' AS origem
         FROM planos_aula pa JOIN professores p ON p.id = pa.professor_id
         WHERE ${w1.join(' AND ')} AND COALESCE(pa.status,'ativo') != 'cancelado'
         ORDER BY pa.data_inicio DESC`,
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
      pool.query(
        `SELECT av.id, av.aluno_nome AS descricao, av.data, av.valor,
                COALESCE(av.repasse_pago,FALSE) AS repasse_pago, av.repasse_pago_em,
                p.percentual_repasse,
                (av.valor * p.percentual_repasse/100) AS repasse, 'avulsa' AS origem
         FROM aulas_avulsas av JOIN professores p ON p.id = av.professor_id
         WHERE ${w3.join(' AND ')} ORDER BY av.data DESC`,
        params3
      ),
      pool.query(`SELECT nome, percentual_repasse FROM professores WHERE id=$1`, [req.params.professorId]),
    ]);

    res.json({
      professor: prof.rows[0] || null,
      planos:    planos.rows,
      reservas:  reservas.rows,
      avulsas:   avulsas.rows,
    });
  } catch (err) {
    console.error('[GET /repasse/:id/detalhe]', err);
    res.status(500).json({ error: 'Erro ao buscar detalhe' });
  }
});

// Tabelas de origem do repasse e coluna de data de cada uma
const ORIGENS = {
  plano:   { table: 'planos_aula',   dateCol: 'data_inicio', extra: '' },
  reserva: { table: 'reservations',  dateCol: 'date',        extra: ' AND total > 0' },
  avulsa:  { table: 'aulas_avulsas', dateCol: 'data',        extra: '' },
};

// est_ids que o usuário pode alterar (null = sem restrição, só admin)
function allowedEstIds(user) {
  if (user.role === 'admin') return null;
  return Array.from(new Set([
    ...(user.est_ids || []),
    ...(user.est_id ? [user.est_id] : []),
  ])).map(Number).filter(Boolean);
}

/**
 * Define repasse_pago = pago em itens específicos ou em todo o período de um professor.
 * itens: [{ origem: 'plano'|'reserva'|'avulsa', id }]
 * Retorna quantidade de linhas alteradas.
 */
async function setRepasseStatus(user, { itens, professor_id, from, to }, pago) {
  const ests = allowedEstIds(user);
  const setSql = pago
    ? 'repasse_pago=TRUE, repasse_pago_em=NOW()'
    : 'repasse_pago=FALSE, repasse_pago_em=NULL';
  const client = await pool.connect();
  let total = 0;
  try {
    await client.query('BEGIN');
    if (Array.isArray(itens) && itens.length) {
      for (const [origem, cfg] of Object.entries(ORIGENS)) {
        const ids = itens.filter(i => i && i.origem === origem).map(i => Number(i.id)).filter(Boolean);
        if (!ids.length) continue;
        const params = [ids];
        let sql = `UPDATE ${cfg.table} SET ${setSql} WHERE id = ANY($1)`;
        if (ests) { params.push(ests); sql += ` AND est_id = ANY($${params.length})`; }
        const r = await client.query(sql, params);
        if (r.rowCount !== ids.length) throw Object.assign(new Error('Item fora do seu estabelecimento ou inexistente'), { status: 403 });
        total += r.rowCount;
      }
    } else if (professor_id) {
      for (const cfg of Object.values(ORIGENS)) {
        const params = [professor_id, !pago];
        let sql = `UPDATE ${cfg.table} SET ${setSql}
                   WHERE professor_id = $1 AND COALESCE(repasse_pago,FALSE) = $2${cfg.extra}`;
        if (cfg.table === 'planos_aula') sql += ` AND COALESCE(status,'ativo') != 'cancelado'`;
        if (from) { params.push(from); sql += ` AND ${cfg.dateCol} >= $${params.length}`; }
        if (to)   { params.push(to);   sql += ` AND ${cfg.dateCol} <= $${params.length}`; }
        if (ests) { params.push(ests); sql += ` AND est_id = ANY($${params.length})`; }
        const r = await client.query(sql, params);
        total += r.rowCount;
      }
    } else {
      throw Object.assign(new Error('Informe itens ou professor_id'), { status: 400 });
    }
    await client.query('COMMIT');
    return total;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// PATCH /api/repasse/marcar — marca itens (ou período do professor) como pagos
// Compatível com o formato antigo { plano_ids, reserva_ids } e o novo { itens }
router.patch('/marcar', auth, adminOrManager, async (req, res) => {
  const { plano_ids, reserva_ids, avulsa_ids, itens, professor_id, from, to } = req.body;
  const lista = Array.isArray(itens) ? itens : [
    ...(plano_ids   || []).map(id => ({ origem: 'plano',   id })),
    ...(reserva_ids || []).map(id => ({ origem: 'reserva', id })),
    ...(avulsa_ids  || []).map(id => ({ origem: 'avulsa',  id })),
  ];
  try {
    const n = await setRepasseStatus(req.user, { itens: lista, professor_id, from, to }, true);
    res.json({ message: 'Repasse marcado como pago', alterados: n });
  } catch (err) {
    console.error('[PATCH /repasse/marcar]', err);
    res.status(err.status || 500).json({ error: err.status ? err.message : 'Erro ao marcar repasse' });
  }
});

// PATCH /api/repasse/status — altera status (pago|pendente) de itens ou do período
// body: { status: 'pago'|'pendente', itens?: [{origem,id}], professor_id?, from?, to? }
router.patch('/status', auth, adminOrManager, async (req, res) => {
  const { status, itens, professor_id, from, to } = req.body;
  if (!['pago', 'pendente'].includes(status)) return res.status(400).json({ error: 'Status inválido' });
  try {
    const n = await setRepasseStatus(req.user, { itens, professor_id, from, to }, status === 'pago');
    res.json({ message: status === 'pago' ? 'Repasse marcado como pago' : 'Repasse revertido para pendente', alterados: n });
  } catch (err) {
    console.error('[PATCH /repasse/status]', err);
    res.status(err.status || 500).json({ error: err.status ? err.message : 'Erro ao alterar status do repasse' });
  }
});

module.exports = router;
