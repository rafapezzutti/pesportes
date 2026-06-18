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

// ── GET /api/finance/contas-a-receber ─────────────────────────────
// Agrega reservas, planos_aula e bar_vendas com status de pgto
router.get('/contas-a-receber', auth, adminOrManager, async (req, res) => {
  const { from, to, estId, status } = req.query;
  try {
    const scopeWhere = (table, dateCol) => {
      const params = [];
      const where  = [];
      if (req.user.role === 'manager' && req.user.est_ids?.length) {
        params.push(req.user.est_ids); where.push(`${table}.est_id = ANY($${params.length})`);
      } else if (req.user.role === 'simples' && req.user.est_id) {
        params.push(req.user.est_id); where.push(`${table}.est_id = $${params.length}`);
      }
      if (estId) { params.push(estId); where.push(`${table}.est_id = $${params.length}`); }
      if (from)  { params.push(from);  where.push(`${table}.${dateCol} >= $${params.length}`); }
      if (to)    { params.push(to);    where.push(`${table}.${dateCol} <= $${params.length}`); }
      if (status){ params.push(status);where.push(`${table}.status_pgto = $${params.length}`); }
      return { params, ws: where.length ? 'WHERE ' + where.join(' AND ') : '' };
    };

    const { params: p1, ws: w1 } = scopeWhere('r', 'date');
    const { rows: reservasRaw } = await pool.query(
      `SELECT r.id, r.client_name, r.date, r.total, r.status_pgto, r.forma_pgto,
              r.start_time, r.end_time, r.participantes,
              e.name AS est_name
       FROM reservations r
       LEFT JOIN establishments e ON r.est_id = e.id
       ${w1} ORDER BY r.date DESC`, p1);

    // Expande reservas com participantes em linhas individuais proporcional
    const reservas = [];
    for (const r of reservasRaw) {
      const parts = Array.isArray(r.participantes) ? r.participantes : [];
      if (parts.length > 0) {
        for (const p of parts) {
          const pct = Number(p.percentual) || (100 / parts.length);
          reservas.push({
            id: r.id, tipo: 'reserva',
            cliente: p.nome,
            data: r.date,
            total: Math.round((Number(r.total) * pct / 100) * 100) / 100,
            status_pgto: p.status_pgto || r.status_pgto || 'pendente',
            forma_pgto: p.forma_pgto || r.forma_pgto,
            est_name: r.est_name,
            start_time: r.start_time, end_time: r.end_time,
            participante_key: p.nome, // para o PATCH saber qual participante
            grupo: true,
          });
        }
      } else {
        reservas.push({
          id: r.id, tipo: 'reserva',
          cliente: r.client_name,
          data: r.date,
          total: r.total,
          status_pgto: r.status_pgto || 'pendente',
          forma_pgto: r.forma_pgto,
          est_name: r.est_name,
          start_time: r.start_time, end_time: r.end_time,
        });
      }
    }

    const { params: p2, ws: w2 } = scopeWhere('pl', 'data_inicio');
    const { rows: aulas } = await pool.query(
      `SELECT pl.id, 'aula' AS tipo, pl.nome_aluno AS cliente, pl.data_inicio AS data,
              pl.valor AS total, pl.status_pgto, pl.forma_pgto, e.name AS est_name,
              pl.tipo AS subtipo
       FROM planos_aula pl
       LEFT JOIN establishments e ON pl.est_id = e.id
       ${w2} ORDER BY pl.data_inicio DESC`, p2);

    const { params: p3, ws: w3 } = scopeWhere('b', 'data_venda');
    const { rows: bar } = await pool.query(
      `SELECT b.id, 'bar' AS tipo, b.cliente_nome AS cliente, b.data_venda AS data,
              b.total, b.status_pgto, b.forma_pgto, e.name AS est_name, b.foto
       FROM bar_vendas b
       LEFT JOIN establishments e ON b.est_id = e.id
       ${w3} ORDER BY b.data_venda DESC`, p3);

    const { params: p4, ws: w4 } = scopeWhere('m', 'data_venda');
    const { rows: manut } = await pool.query(
      `SELECT m.id, 'manutencao' AS tipo, m.cliente_nome AS cliente, m.data_venda AS data,
              m.total, m.status_pgto, m.forma_pgto, e.name AS est_name
       FROM manutencao_vendas m
       LEFT JOIN establishments e ON m.est_id = e.id
       ${w4} ORDER BY m.data_venda DESC`, p4);

    const all = [...reservas, ...aulas, ...bar, ...manut]
      .sort((a, b) => new Date(b.data) - new Date(a.data));

    res.json(all);
  } catch (err) {
    console.error('[GET /finance/contas-a-receber]', err);
    res.status(500).json({ error: 'Erro ao listar contas a receber' });
  }
});

// ── PATCH /api/finance/contas-a-receber/:tipo/:id ─────────────────
router.patch('/contas-a-receber/:tipo/:id', auth, adminOrManager, async (req, res) => {
  const { tipo, id } = req.params;
  const { status_pgto, forma_pgto } = req.body;
  const tableMap = { reserva: 'reservations', aula: 'planos_aula', bar: 'bar_vendas', manutencao: 'manutencao_vendas' };
  const table = tableMap[tipo];
  if (!table) return res.status(400).json({ error: 'Tipo inválido' });
  try {
    await pool.query(
      `UPDATE ${table} SET
         status_pgto = COALESCE($1, status_pgto),
         forma_pgto  = COALESCE($2, forma_pgto)
       WHERE id = $3`,
      [status_pgto || null, forma_pgto || null, id]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('[PATCH /finance/contas-a-receber]', err);
    res.status(500).json({ error: 'Erro ao atualizar' });
  }
});

// ── GET /api/finance/resumo-aluno ─────────────────────────────────
router.get('/resumo-aluno', auth, adminOrManager, async (req, res) => {
  const { aluno_nome, mes } = req.query;
  if (!aluno_nome || !mes) return res.status(400).json({ error: 'aluno_nome e mes são obrigatórios' });

  const from = `${mes}-01`;
  const toDate = new Date(new Date(from).getFullYear(), new Date(from).getMonth() + 1, 0);
  const to = toDate.toISOString().split('T')[0];

  try {
    const { rows: aulas } = await pool.query(
      `SELECT pl.id, pl.tipo, pl.data_inicio AS data, pl.valor AS total,
              pl.status_pgto, pl.forma_pgto, e.name AS est_name
       FROM planos_aula pl
       LEFT JOIN establishments e ON pl.est_id = e.id
       WHERE LOWER(pl.nome_aluno) = LOWER($1)
         AND pl.data_inicio >= $2 AND pl.data_inicio <= $3
       ORDER BY pl.data_inicio`,
      [aluno_nome, from, to]);

    const { rows: reservas } = await pool.query(
      `SELECT r.id, r.date AS data, r.total, r.status_pgto, r.forma_pgto,
              r.start_time, r.end_time, e.name AS est_name, p.name AS ponto_name
       FROM reservations r
       LEFT JOIN establishments e ON r.est_id = e.id
       LEFT JOIN points p ON r.point_id = p.id
       WHERE LOWER(r.client_name) = LOWER($1)
         AND r.date >= $2 AND r.date <= $3
       ORDER BY r.date`,
      [aluno_nome, from, to]);

    const { rows: bar } = await pool.query(
      `SELECT b.id, b.data_venda AS data, b.total, b.status_pgto, b.forma_pgto,
              b.itens, e.name AS est_name
       FROM bar_vendas b
       LEFT JOIN establishments e ON b.est_id = e.id
       WHERE LOWER(b.cliente_nome) = LOWER($1)
         AND b.data_venda >= $2 AND b.data_venda <= $3
       ORDER BY b.data_venda`,
      [aluno_nome, from, to]);

    const { rows: manutencao } = await pool.query(
      `SELECT m.id, m.data_venda AS data, m.total, m.status_pgto, m.forma_pgto,
              m.itens, e.name AS est_name
       FROM manutencao_vendas m
       LEFT JOIN establishments e ON m.est_id = e.id
       WHERE LOWER(m.cliente_nome) = LOWER($1)
         AND m.data_venda >= $2 AND m.data_venda <= $3
       ORDER BY m.data_venda`,
      [aluno_nome, from, to]);

    const totalAulas    = aulas.reduce((s, r) => s + Number(r.total), 0);
    const totalReservas = reservas.reduce((s, r) => s + Number(r.total), 0);
    const totalBar      = bar.reduce((s, r) => s + Number(r.total), 0);
    const totalManut    = manutencao.reduce((s, r) => s + Number(r.total), 0);

    res.json({
      aluno_nome, mes, aulas, reservas, bar, manutencao,
      totais: { aulas: totalAulas, reservas: totalReservas, bar: totalBar, manutencao: totalManut,
                geral: totalAulas + totalReservas + totalBar + totalManut },
    });
  } catch (err) {
    console.error('[GET /finance/resumo-aluno]', err);
    res.status(500).json({ error: 'Erro ao gerar resumo' });
  }
});

// ── POST /api/finance/resumo-aluno/email ─────────────────────────
router.post('/resumo-aluno/email', auth, adminOrManager, async (req, res) => {
  const { aluno_nome, aluno_email, mes, resumo = {} } = req.body;
  if (!aluno_email) return res.status(400).json({ error: 'Email do aluno é obrigatório' });

  const { Resend } = require('resend');
  const resend = new Resend(process.env.RESEND_API_KEY);

  const mesLabel = new Date(`${mes}-15`).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
  const fmtMoney = v => Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const fmtDt = d => d ? d.split('T')[0].split('-').reverse().join('/') : '';

  const makeRows = (items, descFn) => items.map(i =>
    `<tr><td style="padding:6px 10px;border-bottom:1px solid #f3f4f6">${descFn(i)}</td>
     <td style="padding:6px 10px;border-bottom:1px solid #f3f4f6">${fmtDt(i.data)}</td>
     <td style="padding:6px 10px;border-bottom:1px solid #f3f4f6;text-align:right">${fmtMoney(i.total)}</td>
     <td style="padding:6px 10px;border-bottom:1px solid #f3f4f6">${i.status_pgto || 'pendente'}</td></tr>`
  ).join('');

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;color:#111">
      <div style="background:#16a34a;padding:24px;text-align:center">
        <h1 style="color:#fff;margin:0;font-size:22px">P. Soluções Esportes</h1>
        <p style="color:#d1fae5;margin:6px 0 0">Resumo — ${mesLabel}</p>
      </div>
      <div style="padding:24px">
        <p>Olá, <strong>${aluno_nome}</strong>! Segue seu resumo financeiro.</p>
        <table style="width:100%;border-collapse:collapse;font-size:13px;margin-top:16px">
          <thead><tr style="background:#f0fdf4">
            <th style="padding:8px 10px;text-align:left;border-bottom:2px solid #d1fae5">Descrição</th>
            <th style="padding:8px 10px;text-align:left;border-bottom:2px solid #d1fae5">Data</th>
            <th style="padding:8px 10px;text-align:right;border-bottom:2px solid #d1fae5">Valor</th>
            <th style="padding:8px 10px;text-align:left;border-bottom:2px solid #d1fae5">Status</th>
          </tr></thead>
          <tbody>
            ${makeRows(resumo.aulas || [], a => `Aula/Plano${a.tipo ? ' — ' + a.tipo : ''}`)}
            ${makeRows(resumo.reservas || [], r => `Reserva${r.ponto_name ? ' — ' + r.ponto_name : ''}`)}
            ${makeRows(resumo.bar || [], () => 'Consumo Bar')}
            ${makeRows(resumo.manutencao || [], () => 'Manutenção/Equipamento')}
          </tbody>
        </table>
        <div style="margin-top:20px;padding:16px;background:#f9fafb;border-radius:8px">
          <p style="margin:4px 0">Aulas/Planos: <strong>${fmtMoney(resumo.totais?.aulas || 0)}</strong></p>
          <p style="margin:4px 0">Reservas: <strong>${fmtMoney(resumo.totais?.reservas || 0)}</strong></p>
          <p style="margin:4px 0">Bar: <strong>${fmtMoney(resumo.totais?.bar || 0)}</strong></p>
          ${(resumo.totais?.manutencao > 0) ? `<p style="margin:4px 0">Manutenção: <strong>${fmtMoney(resumo.totais?.manutencao || 0)}</strong></p>` : ''}
          <p style="margin:12px 0 4px;font-size:16px;font-weight:bold;color:#16a34a">
            Total Geral: ${fmtMoney(resumo.totais?.geral || 0)}</p>
        </div>
        <p style="font-size:12px;color:#9ca3af;margin-top:24px">
          Dúvidas? Fale conosco: 11 92044-2015 | rafael.pezzutti@psolucoes-ia.com</p>
      </div>
    </div>`;

  try {
    await resend.emails.send({
      from: 'P. Soluções Esportes <noreply@pesportes.ia.br>',
      to: aluno_email,
      subject: `Resumo financeiro — ${mesLabel} | P. Soluções`,
      html,
    });
    res.json({ ok: true });
  } catch (err) {
    console.error('[POST /finance/resumo-aluno/email]', err);
    res.status(500).json({ error: 'Erro ao enviar email' });
  }
});

module.exports = router;
