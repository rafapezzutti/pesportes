const router = require('express').Router();
const bcrypt = require('bcryptjs');
const pool   = require('../db/pool');
const { auth, adminOnly, adminOrManager } = require('../middleware/auth');

// ── GET /api/crm-users ───────────────────────────────────────────
router.get('/', auth, adminOrManager, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT cu.id, cu.name, cu.email, cu.role, cu.est_id,
             e.name AS est_name, cu.created_at
      FROM crm_users cu
      LEFT JOIN establishments e ON cu.est_id = e.id
      ORDER BY cu.name
    `);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao listar usuários' });
  }
});

// ── POST /api/crm-users ──────────────────────────────────────────
router.post('/', auth, adminOrManager, async (req, res) => {
  const { name, email, password, role, est_id } = req.body;
  if (!name || !email || !password)
    return res.status(400).json({ error: 'name, email e password obrigatórios' });
  if (password.length < 6)
    return res.status(400).json({ error: 'Senha mínima: 6 caracteres' });

  // Gerente só pode criar usuário simples
  const allowedRoles = req.user.role === 'admin'
    ? ['admin', 'manager', 'simples']
    : ['simples'];
  if (!allowedRoles.includes(role))
    return res.status(403).json({ error: 'Você só pode criar usuários do tipo Simples' });

  if (role !== 'admin' && !est_id)
    return res.status(400).json({ error: 'Gerentes e usuários simples precisam de um estabelecimento' });

  try {
    const exists = await pool.query('SELECT id FROM crm_users WHERE email=$1', [email.toLowerCase()]);
    if (exists.rows.length) return res.status(409).json({ error: 'Email já cadastrado' });

    const hash = await bcrypt.hash(password, 10);
    const { rows } = await pool.query(
      `INSERT INTO crm_users (name, email, password_hash, role, est_id)
       VALUES ($1,$2,$3,$4,$5) RETURNING id, name, email, role, est_id`,
      [name, email.toLowerCase(), hash, role, role === 'admin' ? null : (est_id || null)]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao criar usuário' });
  }
});

// ── PUT /api/crm-users/:id — somente admin ───────────────────────
router.put('/:id', auth, adminOnly, async (req, res) => {
  const { name, email, password, role, est_id } = req.body;
  if (!['admin', 'manager', 'simples'].includes(role))
    return res.status(400).json({ error: 'Role inválido' });
  if (role !== 'admin' && !est_id)
    return res.status(400).json({ error: 'Gerentes e usuários simples precisam de um estabelecimento' });

  try {
    const resolvedEstId = role === 'admin' ? null : (est_id || null);
    let query, params;
    if (password) {
      if (password.length < 6)
        return res.status(400).json({ error: 'Senha mínima: 6 caracteres' });
      const hash = await bcrypt.hash(password, 10);
      query  = `UPDATE crm_users SET name=$1, email=$2, password_hash=$3, role=$4, est_id=$5
                WHERE id=$6 RETURNING id, name, email, role, est_id`;
      params = [name, email.toLowerCase(), hash, role, resolvedEstId, req.params.id];
    } else {
      query  = `UPDATE crm_users SET name=$1, email=$2, role=$3, est_id=$4
                WHERE id=$5 RETURNING id, name, email, role, est_id`;
      params = [name, email.toLowerCase(), role, resolvedEstId, req.params.id];
    }
    const { rows } = await pool.query(query, params);
    if (!rows.length) return res.status(404).json({ error: 'Usuário não encontrado' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao atualizar usuário' });
  }
});

// ── DELETE /api/crm-users/:id — somente admin ───────────────────
router.delete('/:id', auth, adminOnly, async (req, res) => {
  try {
    if (Number(req.params.id) === req.user.id)
      return res.status(400).json({ error: 'Você não pode excluir sua própria conta' });
    await pool.query('DELETE FROM crm_users WHERE id=$1', [req.params.id]);
    res.json({ message: 'Usuário excluído' });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao excluir usuário' });
  }
});

module.exports = router;
