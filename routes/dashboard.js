const router = require('express').Router();
const pool   = require('../db/pool');
const { auth, crmOnly } = require('../middleware/auth');

// Dashboard: admin ve tudo | manager filtra por est_ids | simples por est_id
router.get('/', auth, crmOnly, async (req, res) => {
  try {
    const { role, est_id, est_ids } = req.user;

    // date and month filters from query params
    const today      = req.query.date  || new Date().toISOString().split('T')[0];
    const monthStart = req.query.month ? req.query.month + '-01' : today.slice(0, 7) + '-01';

    let estClause = '';
    let estParam  = null;
    if (role === 'simples' && est_id) {
      estClause = 'AND r.est_id = $2';
      estParam  = est_id;
    } else if (role === 'manager' && est_ids && est_ids.length > 0) {
      estClause = 'AND r.est_id = ANY($2)';
      estParam  = est_ids;
    }
    const restricted = !!estParam;

    const todayRes = await pool.query(`
      SELECT p.name  AS point_name,
             e.name  AS est_name,
             COUNT(*)::int                       AS count,
             COALESCE(SUM(r.total), 0)::numeric  AS total
      FROM reservations r
      JOIN points         p ON r.point_id = p.id
      JOIN establishments e ON r.est_id   = e.id
      WHERE r.date = $1 AND r.status = 'confirmed'
      ${estClause}
      GROUP BY p.id, p.name, e.name
      ORDER BY e.name, p.name
    `, restricted ? [today, estParam] : [today]);

    const monthPtRes = await pool.query(`
      SELECT p.name  AS point_name,
             e.name  AS est_name,
             COUNT(*)::int                       AS count,
             COALESCE(SUM(r.total), 0)::numeric  AS total
      FROM reservations r
      JOIN points         p ON r.point_id = p.id
      JOIN establishments e ON r.est_id   = e.id
      WHERE r.date >= $1 AND r.status = 'confirmed'
      ${estClause}
      GROUP BY p.id, p.name, e.name
      ORDER BY e.name, p.name
    `, restricted ? [monthStart, estParam] : [monthStart]);

    const monthPayRes = await pool.query(`
      SELECT COALESCE(r.payment_method, 'dinheiro') AS payment_method,
             COUNT(*)::int                           AS count,
             COALESCE(SUM(r.total), 0)::numeric      AS total
      FROM reservations r
      WHERE r.date >= $1 AND r.status = 'confirmed'
      ${estClause}
      GROUP BY r.payment_method
      ORDER BY r.payment_method
    `, restricted ? [monthStart, estParam] : [monthStart]);

    res.json({
      today:        todayRes.rows,
      monthByPoint: monthPtRes.rows,
      monthByPay:   monthPayRes.rows,
    });
  } catch (err) {
    console.error('[dashboard]', err);
    res.status(500).json({ error: 'Erro ao buscar estatisticas' });
  }
});

// GET /api/dashboard/cliente?nome=João — resumo completo por cliente
router.get('/cliente', auth, crmOnly, async (req, res) => {
  const { nome } = req.query;
  if (!nome) return res.status(400).json({ error: 'Parâmetro nome é obrigatório' });

  const search = `%${nome}%`;

  try {
    // Planos de aula
    const planosRes = await pool.query(`
      SELECT pl.id, pl.nome_aluno AS cliente_nome, pl.tipo_plano, pl.valor,
             pl.data_inicio, pl.data_fim, pl.status,
             pl.horario_inicio, pl.horario_fim, pl.recorrencia,
             pr.nome AS professor_nome, e.name AS est_name
      FROM planos_aula pl
      LEFT JOIN professores    pr ON pl.professor_id = pr.id
      LEFT JOIN establishments e  ON pl.est_id       = e.id
      WHERE pl.nome_aluno ILIKE $1
      ORDER BY pl.data_inicio DESC
    `, [search]);

    // Reservas de espaço
    const reservasRes = await pool.query(`
      SELECT r.id, COALESCE(pu.name, r.client_name) AS cliente_nome,
             r.date, r.start_time, r.end_time, r.hours, r.total, r.status,
             p.name AS point_name, e.name AS est_name
      FROM reservations r
      LEFT JOIN public_users  pu ON r.user_id  = pu.id
      JOIN points         p  ON r.point_id = p.id
      JOIN establishments e  ON r.est_id   = e.id
      WHERE COALESCE(pu.name, r.client_name) ILIKE $1
      ORDER BY r.date DESC
    `, [search]);

    // Bar
    const barRes = await pool.query(`
      SELECT b.id, b.cliente_nome, b.itens, b.total, b.created_at, e.name AS est_name
      FROM bar_vendas b
      LEFT JOIN establishments e ON b.est_id = e.id
      WHERE b.cliente_nome ILIKE $1
      ORDER BY b.created_at DESC
    `, [search]);

    // Manutenção
    const manutRes = await pool.query(`
      SELECT m.id, m.cliente_nome, m.itens, m.total, m.created_at, e.name AS est_name
      FROM manutencao_vendas m
      LEFT JOIN establishments e ON m.est_id = e.id
      WHERE m.cliente_nome ILIKE $1
      ORDER BY m.created_at DESC
    `, [search]);

    // Totais
    const totalAulas     = planosRes.rows.reduce((s, r) => s + Number(r.valor), 0);
    const totalReservas  = reservasRes.rows.reduce((s, r) => s + Number(r.total), 0);
    const totalBar       = barRes.rows.reduce((s, r) => s + Number(r.total), 0);
    const totalManut     = manutRes.rows.reduce((s, r) => s + Number(r.total), 0);

    res.json({
      cliente: nome,
      planos:     planosRes.rows,
      reservas:   reservasRes.rows,
      bar:        barRes.rows,
      manutencao: manutRes.rows,
      totais: {
        aulas:      totalAulas,
        reservas:   totalReservas,
        bar:        totalBar,
        manutencao: totalManut,
        geral:      totalAulas + totalReservas + totalBar + totalManut,
      },
    });
  } catch (err) {
    console.error('[dashboard/cliente]', err);
    res.status(500).json({ error: 'Erro ao buscar dados do cliente' });
  }
});

module.exports = router;
