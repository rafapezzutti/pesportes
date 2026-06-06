const router = require('express').Router();
const pool   = require('../db/pool');
const { auth, adminOrManager } = require('../middleware/auth');

// Monta filtro de estabelecimento + período para uma coluna de data
function build(req, dateCol, { estId, from, to }, extra = '') {
  const params = [];
  const where = [];
  if (req.user.role === 'manager' && req.user.est_ids?.length) {
    params.push(req.user.est_ids); where.push(`est_id = ANY($${params.length})`);
  } else if (req.user.role === 'simples' && req.user.est_id) {
    params.push(req.user.est_id); where.push(`est_id = $${params.length}`);
  }
  if (estId) { params.push(estId); where.push(`est_id = $${params.length}`); }
  if (from)  { params.push(from);  where.push(`${dateCol} >= $${params.length}`); }
  if (to)    { params.push(to);    where.push(`${dateCol} <= $${params.length}`); }
  if (extra) where.push(extra);
  return { params, whereSql: where.length ? 'WHERE ' + where.join(' AND ') : '' };
}

// GET /api/finance/cashflow?estId=&from=&to=
// Consolida receitas (reservas, bar, manutenção, planos) e despesas pagas.
router.get('/cashflow', auth, adminOrManager, async (req, res) => {
  const q = req.query;
  try {
    const sum = async (table, dateCol, extra) => {
      const { params, whereSql } = build(req, dateCol, q, extra);
      const { rows } = await pool.query(
        `SELECT COALESCE(SUM(total),0)::numeric AS v, COUNT(*)::int AS c FROM ${table} ${whereSql}`, params
      );
      return { total: Number(rows[0].v), count: rows[0].c };
    };

    const reservas    = await sum('reservations', 'date', `status IN ('confirmed','completed')`);
    const bar         = await sum('bar_vendas', 'data_venda');
    const manutencao  = await sum('manutencao_vendas', 'data_venda');

    // planos usam coluna 'valor' (não 'total')
    const pl = build(req, 'data_inicio', q);
    const { rows: planoRows } = await pool.query(
      `SELECT COALESCE(SUM(valor),0)::numeric AS v, COUNT(*)::int AS c FROM planos_aula ${pl.whereSql}`, pl.params);
    const planos = { total: Number(planoRows[0].v), count: planoRows[0].c };

    // despesas pagas no período (por vencimento)
    const ex = build(req, 'vencimento', q, 'pago = TRUE');
    const { rows: exRows } = await pool.query(
      `SELECT COALESCE(SUM(valor),0)::numeric AS v, COUNT(*)::int AS c FROM expenses ${ex.whereSql}`, ex.params);
    const despesas = { total: Number(exRows[0].v), count: exRows[0].c };

    const receita = reservas.total + bar.total + manutencao.total + planos.total;
    res.json({
      receitas: { reservas, bar, manutencao, planos, total: receita },
      despesas,
      saldo: receita - despesas.total,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao gerar fluxo de caixa' });
  }
});

module.exports = router;
