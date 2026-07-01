const router = require('express').Router();
const pool   = require('../db/pool');
const { auth, adminOnly } = require('../middleware/auth');

// Qualquer CRM com role admin ou o próprio gerente
function canAccess(user) {
  return user.role === 'admin' || user.role === 'manager';
}

// GET /api/comissao-gerente?from=&to=
// Lista todos os gerentes com suas comissões sobre reservas
router.get('/', auth, async (req, res) => {
  if (!canAccess(req.user)) return res.status(403).json({ error: 'Sem permissão' });

  const { from, to } = req.query;
  const params = [];
  const rWhere = ["r.status != 'cancelled'"];

  if (from) { params.push(from); rWhere.push(`r.date >= $${params.length}`); }
  if (to)   { params.push(to);   rWhere.push(`r.date <= $${params.length}`); }

  // Se for gerente, filtra só pelos seus estabelecimentos
  let managerFilter = '';
  if (req.user.role === 'manager') {
    const ids = [...(req.user.est_ids||[]), ...(req.user.est_id?[req.user.est_id]:[])].map(Number).filter(Boolean);
    if (ids.length) {
      params.push(ids);
      managerFilter = `AND cu.id = (SELECT id FROM crm_users WHERE id = $${params.length} LIMIT 1)`;
      // sobrescreve: filtra gerente logado
      params.pop();
      params.push(req.user.id);
      managerFilter = `AND cu.id = $${params.length}`;
    }
  }

  const rWhereSql = rWhere.length ? 'WHERE ' + rWhere.join(' AND ') : '';

  try {
    const { rows } = await pool.query(
      `SELECT
         cu.id                                           AS gerente_id,
         cu.name                                         AS gerente_nome,
         cu.email                                        AS gerente_email,
         COALESCE(cu.percentual_comissao, 0)             AS percentual_comissao,
         e.id                                            AS est_id,
         e.name                                          AS est_nome,
         COUNT(r.id)::int                                AS qtd_reservas,
         COALESCE(SUM(r.total), 0)                       AS total_reservas,
         COALESCE(SUM(r.total * COALESCE(cu.percentual_comissao,0) / 100), 0) AS comissao_devida,
         COALESCE(SUM(r.total * COALESCE(cu.percentual_comissao,0) / 100)
           FILTER (WHERE cu.comissao_paga_ate >= r.date), 0) AS comissao_paga,
         COALESCE(SUM(r.total * COALESCE(cu.percentual_comissao,0) / 100)
           FILTER (WHERE cu.comissao_paga_ate IS NULL OR cu.comissao_paga_ate < r.date), 0) AS comissao_pendente
       FROM crm_users cu
       JOIN establishments e ON (
         e.id = ANY(COALESCE(cu.est_ids, ARRAY[]::int[]))
         OR e.id = cu.est_id
       )
       LEFT JOIN reservations r ON r.est_id = e.id ${rWhereSql.replace('WHERE','AND')}
       WHERE cu.role = 'manager' AND cu.ativo = TRUE ${managerFilter}
       GROUP BY cu.id, cu.name, cu.email, cu.percentual_comissao, cu.comissao_paga_ate, e.id, e.name
       ORDER BY cu.name, e.name`,
      params
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao calcular comissão' });
  }
});

// PATCH /api/comissao-gerente/:gerenteId/percentual — atualiza %
router.patch('/:gerenteId/percentual', auth, adminOnly, async (req, res) => {
  const { percentual } = req.body;
  if (percentual == null || isNaN(Number(percentual)))
    return res.status(400).json({ error: 'Percentual inválido' });
  try {
    await pool.query(
      `UPDATE crm_users SET percentual_comissao = $1 WHERE id = $2 AND role = 'manager'`,
      [Number(percentual), req.params.gerenteId]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao atualizar percentual' });
  }
});

// PATCH /api/comissao-gerente/:gerenteId/marcar-pago — marca comissão como paga até hoje
router.patch('/:gerenteId/marcar-pago', auth, adminOnly, async (req, res) => {
  const { ate } = req.body; // data até qual está pago (YYYY-MM-DD), default hoje
  try {
    const paidDate = ate || new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
    await pool.query(
      `UPDATE crm_users SET comissao_paga_ate = $1 WHERE id = $2 AND role = 'manager'`,
      [paidDate, req.params.gerenteId]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao marcar comissão como paga' });
  }
});

module.exports = router;
