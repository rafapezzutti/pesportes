const router = require('express').Router();
const pool   = require('../db/pool');
const { auth, crmOnly } = require('../middleware/auth');

// Dashboard: admin ve tudo | manager filtra por est_ids | simples por est_id
router.get('/', auth, crmOnly, async (req, res) => {
  try {
    const { role, est_id, est_ids } = req.user;

    const today      = new Date().toISOString().split('T')[0];
    const monthStart = today.slice(0, 7) + '-01';

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

module.exports = router;
