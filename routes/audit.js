const router = require('express').Router();
const pool = require('../db/pool');
const { auth, adminOnly } = require('../middleware/auth');

// GET /api/audit — lista logs com filtros e paginação (somente admin)
// Query: action, entity, user_id, date_from, date_to, search, limit, offset
router.get('/', auth, adminOnly, async (req, res) => {
  const { action, entity, user_id, date_from, date_to, search } = req.query;
  const limit  = Math.min(parseInt(req.query.limit)  || 50, 200);
  const offset = parseInt(req.query.offset) || 0;

  const where = [];
  const params = [];
  const add = (sql, val) => { params.push(val); where.push(sql.replace('?', `$${params.length}`)); };

  if (action)    add('a.action = ?', action);
  if (entity)    add('a.entity = ?', entity);
  if (user_id)   add('a.user_id = ?', user_id);
  if (date_from) add('a.created_at >= ?', date_from);
  if (date_to)   add('a.created_at < ?', `${date_to}T23:59:59.999`);
  if (search) {
    params.push(`%${search}%`);
    where.push(`(cu.name ILIKE $${params.length} OR a.path ILIKE $${params.length})`);
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  try {
    const { rows } = await pool.query(
      `SELECT a.*, cu.name AS user_name, cu.email AS user_email
       FROM audit_logs a
       LEFT JOIN crm_users cu ON a.user_id = cu.id AND a.user_type = 'crm'
       ${whereSql}
       ORDER BY a.created_at DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset]
    );
    const { rows: [{ count }] } = await pool.query(
      `SELECT COUNT(*)::int AS count FROM audit_logs a
       LEFT JOIN crm_users cu ON a.user_id = cu.id AND a.user_type = 'crm'
       ${whereSql}`, params
    );
    res.json({ logs: rows, total: count, limit, offset });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/audit/filters — valores para os selects da tela
router.get('/filters', auth, adminOnly, async (req, res) => {
  try {
    const [entities, users] = await Promise.all([
      pool.query(`SELECT DISTINCT entity FROM audit_logs WHERE entity IS NOT NULL ORDER BY entity`),
      pool.query(
        `SELECT DISTINCT a.user_id, cu.name AS user_name
         FROM audit_logs a
         LEFT JOIN crm_users cu ON a.user_id = cu.id AND a.user_type = 'crm'
         WHERE a.user_id IS NOT NULL ORDER BY cu.name`
      ),
    ]);
    res.json({
      entities: entities.rows.map(r => r.entity),
      users: users.rows.filter(r => r.user_id),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
