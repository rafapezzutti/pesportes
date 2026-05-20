const router = require('express').Router();
const pool   = require('../db/pool');
const { auth, crmOnly } = require('../middleware/auth');

// Retorna estatísticas para o dashboard (admin vê tudo, manager/simples vê só o seu est.)
router.get('/', auth, crmOnly, async (req, res) => {
  try {
    const { role, est_id } = req.user;
    const restricted = (role === 'manager' || role === 'simples') && est_id;

    const today      = new Date().toISOString().split('T')[0];
    const monthStart = today.slice(0, 7) + '-01';

    // Cláusula de filtro por estabelecimento
    const estClause = restricted ? 'AND r.est_id = $2' : '';

    // ── Hoje por ponto ──────────────────────────────────────────
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
    `, restricted ? [today, est_id] : [today]);

    // ── Mês corrente por ponto ──────────────────────────────────
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
    `, restricted ? [monthStart, est_id] : [monthStart]);

    // ── Mês corrente por forma de pagamento ─────────────────────
    const monthPayRes = await pool.query(`
      SELECT COALESCE(r.payment_method, 'dinheiro') AS payment_method,
             COUNT(*)::int                           AS count,
             COALESCE(SUM(r.total), 0)::numeric      AS total
      FROM reservations r
      WHERE r.date >= $1 AND r.status = 'confirmed'
      ${estClause}
      GROUP BY r.payment_method
      ORDER BY r.payment_method
    `, restricted ? [monthStart, est_id] : [monthStart]);

    res.json({
      today:        todayRes.rows,
      monthByPoint: monthPtRes.rows,
      monthByPay:   monthPayRes.rows,
    });
  } catch (err) {
    console.error('[dashboard]', err);
    res.status(500).json({ error: 'Erro ao buscar estatísticas' });
  }
});

module.exports = router;
