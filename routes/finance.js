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

// Filtro de estabelecimento simples (sem data) para uma coluna est_id
function estScope(req, params, estId) {
  const where = [];
  if (req.user.role === 'manager' && req.user.est_ids?.length) {
    params.push(req.user.est_ids); where.push(`est_id = ANY($${params.length})`);
  } else if (req.user.role === 'simples' && req.user.est_id) {
    params.push(req.user.est_id); where.push(`est_id = $${params.length}`);
  }
  if (estId) { params.push(estId); where.push(`est_id = $${params.length}`); }
  return where;
}

// GET /api/finance/projecao?estId=&saldoInicial=
// Projeta o caixa para 30/60/90/180/360 dias a partir de:
//   + receita recorrente mensal (planos ativos: mensal/trimestral/semestral)
//   - folha mensal (funcionários ativos: salário+encargos+benefícios+VT)
//   - despesas recorrentes mensais (mensal e anual/12)
//   - despesas pontuais futuras não pagas, na data do vencimento
router.get('/projecao', auth, adminOrManager, async (req, res) => {
  const { estId } = req.query;
  const saldoInicial = parseFloat(req.query.saldoInicial) || 0;
  try {
    // Receita recorrente mensal
    const p1 = []; const w1 = estScope(req, p1, estId);
    w1.push(`status = 'ativo'`);
    const { rows: planos } = await pool.query(
      `SELECT COALESCE(SUM(
          CASE tipo
            WHEN 'mensal'     THEN valor
            WHEN 'trimestral' THEN valor/3.0
            WHEN 'semestral'  THEN valor/6.0
            ELSE 0 END),0) AS v
        FROM planos_aula ${'WHERE ' + w1.join(' AND ')}`, p1);
    const receitaMensal = Number(planos[0].v);

    // Folha mensal
    const p2 = []; const w2 = estScope(req, p2, estId);
    w2.push('ativo = TRUE');
    const { rows: folha } = await pool.query(
      `SELECT COALESCE(SUM(salario_base + encargos + beneficios + vale_transporte),0) AS v
        FROM employees ${'WHERE ' + w2.join(' AND ')}`, p2);
    const folhaMensal = Number(folha[0].v);

    // Despesas recorrentes mensais (mensal = valor; anual = valor/12)
    const p3 = []; const w3 = estScope(req, p3, estId);
    w3.push(`recorrencia IN ('mensal','anual')`);
    const { rows: drec } = await pool.query(
      `SELECT COALESCE(SUM(CASE recorrencia WHEN 'mensal' THEN valor WHEN 'anual' THEN valor/12.0 ELSE 0 END),0) AS v
        FROM expenses ${'WHERE ' + w3.join(' AND ')}`, p3);
    const despesaRecMensal = Number(drec[0].v);

    const liquidoMensal = receitaMensal - folhaMensal - despesaRecMensal;

    // Despesas pontuais futuras não pagas (únicas), por vencimento
    const p4 = []; const w4 = estScope(req, p4, estId);
    w4.push(`pago = FALSE`, `recorrencia = 'nenhuma'`, `vencimento >= CURRENT_DATE`);
    const { rows: pontuais } = await pool.query(
      `SELECT vencimento, valor FROM expenses ${'WHERE ' + w4.join(' AND ')}`, p4);

    const horizontes = [30, 60, 90, 180, 360];
    const hoje = new Date();
    const projecao = horizontes.map((dias) => {
      const meses = dias / 30;
      const limite = new Date(hoje.getTime() + dias * 86400000);
      const pontuaisPeriodo = pontuais
        .filter(e => new Date(e.vencimento) <= limite)
        .reduce((s, e) => s + Number(e.valor), 0);
      const saldo = saldoInicial + liquidoMensal * meses - pontuaisPeriodo;
      return {
        dias,
        receita_recorrente: receitaMensal * meses,
        folha: folhaMensal * meses,
        despesa_recorrente: despesaRecMensal * meses,
        despesa_pontual: pontuaisPeriodo,
        saldo_projetado: saldo,
      };
    });

    res.json({
      saldo_inicial: saldoInicial,
      mensal: { receita: receitaMensal, folha: folhaMensal, despesa_recorrente: despesaRecMensal, liquido: liquidoMensal },
      projecao,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao gerar projeção' });
  }
});

module.exports = router;
