const router = require('express').Router();
const ExcelJS = require('exceljs');
const pool   = require('../db/pool');
const { auth, adminOrManager } = require('../middleware/auth');

function scope(req, params, col = 'r.est_id') {
  const where = [];
  if (req.user.role === 'manager' && req.user.est_ids?.length) {
    params.push(req.user.est_ids); where.push(`${col} = ANY($${params.length})`);
  } else if (req.user.role === 'simples' && req.user.est_id) {
    params.push(req.user.est_id); where.push(`${col} = $${params.length}`);
  }
  return where;
}

async function send(res, wb, filename) {
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  await wb.xlsx.write(res);
  res.end();
}

const money = { numFmt: 'R$ #,##0.00' };

// GET /api/reports/reservas.xlsx?from=&to=&estId=
router.get('/reservas.xlsx', auth, adminOrManager, async (req, res) => {
  const { from, to, estId } = req.query;
  const params = [];
  const where = scope(req, params);
  if (estId) { params.push(estId); where.push(`r.est_id = $${params.length}`); }
  if (from)  { params.push(from);  where.push(`r.date >= $${params.length}`); }
  if (to)    { params.push(to);    where.push(`r.date <= $${params.length}`); }
  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
  try {
    const { rows } = await pool.query(
      `SELECT r.date, r.start_time, r.end_time, r.hours, r.total, r.status, r.payment_method,
              e.name AS est_name, p.name AS point_name,
              COALESCE(pu.name, r.client_name) AS cliente
       FROM reservations r
       LEFT JOIN establishments e ON e.id = r.est_id
       LEFT JOIN points p ON p.id = r.point_id
       LEFT JOIN public_users pu ON pu.id = r.user_id
       ${whereSql} ORDER BY r.date DESC, r.start_time`, params
    );
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Reservas');
    ws.columns = [
      { header: 'Data', key: 'date', width: 12 },
      { header: 'Início', key: 'start_time', width: 9 },
      { header: 'Fim', key: 'end_time', width: 9 },
      { header: 'Horas', key: 'hours', width: 8 },
      { header: 'Estabelecimento', key: 'est_name', width: 26 },
      { header: 'Espaço', key: 'point_name', width: 22 },
      { header: 'Cliente', key: 'cliente', width: 24 },
      { header: 'Pagamento', key: 'payment_method', width: 12 },
      { header: 'Status', key: 'status', width: 12 },
      { header: 'Total', key: 'total', width: 12, style: money },
    ];
    ws.getRow(1).font = { bold: true };
    rows.forEach(r => ws.addRow({ ...r, date: r.date ? new Date(r.date).toLocaleDateString('pt-BR') : '' }));
    const tot = rows.reduce((s, r) => s + Number(r.total || 0), 0);
    const totRow = ws.addRow({ point_name: 'TOTAL', total: tot });
    totRow.font = { bold: true };
    await send(res, wb, `reservas_${from || 'inicio'}_${to || 'fim'}.xlsx`);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao gerar relatório' });
  }
});

// GET /api/reports/financeiro.xlsx?from=&to=&estId=
router.get('/financeiro.xlsx', auth, adminOrManager, async (req, res) => {
  const { from, to, estId } = req.query;
  const mk = (col, alias = 'est_id') => {
    const params = [];
    const where = [];
    if (req.user.role === 'manager' && req.user.est_ids?.length) { params.push(req.user.est_ids); where.push(`${alias} = ANY($${params.length})`); }
    else if (req.user.role === 'simples' && req.user.est_id) { params.push(req.user.est_id); where.push(`${alias} = $${params.length}`); }
    if (estId) { params.push(estId); where.push(`${alias} = $${params.length}`); }
    if (from)  { params.push(from);  where.push(`${col} >= $${params.length}`); }
    if (to)    { params.push(to);    where.push(`${col} <= $${params.length}`); }
    return { params, whereSql: where.length ? 'WHERE ' + where.join(' AND ') : '' };
  };
  try {
    const q1 = mk('date');
    const reservas = (await pool.query(`SELECT COALESCE(SUM(total),0) v FROM reservations ${q1.whereSql}${q1.whereSql ? ' AND' : ' WHERE'} status IN ('confirmed','completed')`, q1.params)).rows[0].v;
    const q2 = mk('data_venda');
    const bar = (await pool.query(`SELECT COALESCE(SUM(total),0) v FROM bar_vendas ${q2.whereSql}`, q2.params)).rows[0].v;
    const q3 = mk('data_venda');
    const manut = (await pool.query(`SELECT COALESCE(SUM(total),0) v FROM manutencao_vendas ${q3.whereSql}`, q3.params)).rows[0].v;
    const q4 = mk('data_inicio');
    const planos = (await pool.query(`SELECT COALESCE(SUM(valor),0) v FROM planos_aula ${q4.whereSql}`, q4.params)).rows[0].v;
    const q5 = mk('vencimento');
    const desp = (await pool.query(`SELECT COALESCE(SUM(valor),0) v FROM expenses ${q5.whereSql}${q5.whereSql ? ' AND' : ' WHERE'} pago = TRUE`, q5.params)).rows[0].v;

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Financeiro');
    ws.columns = [{ header: 'Categoria', key: 'k', width: 28 }, { header: 'Valor', key: 'v', width: 16, style: money }];
    ws.getRow(1).font = { bold: true };
    const receita = Number(reservas) + Number(bar) + Number(manut) + Number(planos);
    [['Receita — Reservas', reservas], ['Receita — Bar', bar], ['Receita — Manutenção', manut],
     ['Receita — Planos/Aulas', planos], ['RECEITA TOTAL', receita], ['Despesas pagas', -desp],
     ['SALDO', receita - Number(desp)]].forEach(([k, v]) => ws.addRow({ k, v: Number(v) }));
    ws.getRow(6).font = { bold: true };
    ws.getRow(8).font = { bold: true };
    await send(res, wb, `financeiro_${from || 'inicio'}_${to || 'fim'}.xlsx`);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao gerar relatório financeiro' });
  }
});

module.exports = router;
