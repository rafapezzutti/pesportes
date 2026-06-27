const router = require('express').Router();
const bcrypt = require('bcryptjs');
const pool   = require('../db/pool');
const { auth, adminOnly, adminOrManager } = require('../middleware/auth');

// GET /api/crm-users
router.get('/', auth, adminOrManager, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT cu.id, cu.name, cu.email, cu.role, cu.est_id,
             COALESCE(cu.est_ids, '{}') AS est_ids,
             e.name AS est_name, cu.created_at,
             COALESCE(cu.ativo, TRUE) AS ativo
      FROM crm_users cu
      LEFT JOIN establishments e ON cu.est_id = e.id
      ORDER BY cu.name
    `);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao listar usuarios' });
  }
});

// POST /api/crm-users
router.post('/', auth, adminOrManager, async (req, res) => {
  const { name, email, password, role, est_id, est_ids } = req.body;
  if (!name || !email || !password)
    return res.status(400).json({ error: 'name, email e password obrigatorios' });
  if (password.length < 6)
    return res.status(400).json({ error: 'Senha minima: 6 caracteres' });

  const allowedRoles = req.user.role === 'admin'
    ? ['admin', 'manager', 'simples']
    : ['simples'];
  if (!allowedRoles.includes(role))
    return res.status(403).json({ error: 'Voce so pode criar usuarios do tipo Simples' });

  // Gerente pode ser criado sem estabelecimentos (criara o proprio e sera auto-vinculado)
  if (role === 'simples' && !est_id)
    return res.status(400).json({ error: 'Usuario simples precisa de um estabelecimento' });

  try {
    const exists = await pool.query('SELECT id FROM crm_users WHERE email=$1', [email.toLowerCase()]);
    if (exists.rows.length) return res.status(409).json({ error: 'Email ja cadastrado' });

    const hash = await bcrypt.hash(password, 10);
    const resolvedEstId  = role === 'simples' ? (est_id || null) : null;
    const resolvedEstIds = role === 'manager' ? (est_ids || []) : [];

    const { rows } = await pool.query(
      `INSERT INTO crm_users (name, email, password_hash, role, est_id, est_ids)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, name, email, role, est_id, est_ids`,
      [name, email.toLowerCase(), hash, role, resolvedEstId, resolvedEstIds]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao criar usuario' });
  }
});

// PUT /api/crm-users/:id
router.put('/:id', auth, adminOnly, async (req, res) => {
  const { name, email, password, role, est_id, est_ids } = req.body;
  if (!['admin', 'manager', 'simples', 'profissional'].includes(role))
    return res.status(400).json({ error: 'Role invalido' });
  // Gerente pode ter lista vazia (criado antes de ter estabelecimento)
  if (role === 'simples' && !est_id)
    return res.status(400).json({ error: 'Usuario simples precisa de um estabelecimento' });

  try {
    const resolvedEstId  = role === 'simples' ? (est_id || null) : null;
    const resolvedEstIds = role === 'manager' ? (est_ids || []) : [];

    let query, params;
    if (password) {
      if (password.length < 6)
        return res.status(400).json({ error: 'Senha minima: 6 caracteres' });
      const hash = await bcrypt.hash(password, 10);
      query  = `UPDATE crm_users SET name=$1, email=$2, password_hash=$3, role=$4, est_id=$5, est_ids=$6
                WHERE id=$7 RETURNING id, name, email, role, est_id, est_ids`;
      params = [name, email.toLowerCase(), hash, role, resolvedEstId, resolvedEstIds, req.params.id];
    } else {
      query  = `UPDATE crm_users SET name=$1, email=$2, role=$3, est_id=$4, est_ids=$5
                WHERE id=$6 RETURNING id, name, email, role, est_id, est_ids`;
      params = [name, email.toLowerCase(), role, resolvedEstId, resolvedEstIds, req.params.id];
    }
    const { rows } = await pool.query(query, params);
    if (!rows.length) return res.status(404).json({ error: 'Usuario nao encontrado' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao atualizar usuario' });
  }
});

// PATCH /api/crm-users/:id/suspend  — toggle ativo
router.patch('/:id/suspend', auth, adminOnly, async (req, res) => {
  try {
    if (Number(req.params.id) === req.user.id)
      return res.status(400).json({ error: 'Voce nao pode suspender sua propria conta' });
    const { rows } = await pool.query(
      `UPDATE crm_users SET ativo = NOT COALESCE(ativo, TRUE)
       WHERE id=$1 RETURNING id, ativo`,