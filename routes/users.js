const router = require('express').Router();
const bcrypt = require('bcryptjs');
const pool = require('../db/pool');
const { auth, adminOnly } = require('../middleware/auth');

// Todas as rotas exigem admin do CRM
router.use(auth, adminOnly);

// ── GET /api/crm-users ───────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, name, email, role, created_at FROM crm_users ORDER BY name'
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao listar usuários' });
  }
});

// ── POST /api/crm-users — criar ──────────────────────────────────
router.post('/', async (req, res) => {
  const { name, email, password, role } = req.body;
  if (!name || !email || !password)
    return res.status(400).json({ error: 'name, email e password obrigatórios' });
  if (password.length < 6)
    return res.status(400).json({ error: 'Senha mínima: 6 caracteres' });
  if (!['admin','manager'].includes(role))
    return res.status(400).json({ error: 'Role deve ser admin ou manager' });

  try {
    const exists = await pool.query('SELECT id FROM crm_users WHERE email=$1', [email.toLowerCase()]);
    if (exists.rows.length) return res.status(409).json({ error: 'Email já cadastrado' });

    const hash = await bcrypt.hash(password, 10);
    const { rows } = await pool.query(
      `INSERT INTO crm_users (name, email, password_hash, role)
       VALUES ($1,$2,$3,$4) RETURNING id, name, email, role`,
      [name, email.toLowerCase(), hash, role || 'manager']
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao criar usuário' });
  }
});

// ── PUT /api/crm-users/:id — atualizar ──────────────────────────
router.put('/:id', async (req, res) => {
  const { name, email, password, role } = req.body;
  try {
    // Se enviou nova senha, faz hash
    let query, params;
    if (password) {
      if (password.length < 6)
        return res.status(400).json({ error: 'Senha mínima: 6 caracteres' });
      const hash = await bcrypt.hash(password, 10);
      query = `UPDATE crm_users SET name=$1, email=$2, password_hash=$3, role=$4
               WHERE id=$5 RETURNING id, name, email, role`;
      params = [name, email.toLowerCase(), hash, role, req.params.id];
    } else {
      query = `UPDATE crm_users SET name=$1, email=$2, role=$3
               WHERE id=$4 RETURNING id, name, email, role`;
      params = [name, email.toLowerCase(), role, req.params.id];
    }
    const { rows } = await pool.query(query, params);
    if (!rows.length) return res.status(404).json({ error: 'Usuário não encontrado' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao atualizar usuário' });
  }
});

// ── DELETE /api/crm-users/:id ────────────────────────────────────
router.delete('/:id', async (req, res) => {
  try {
    // Não pode excluir a si mesmo
    if (Number(req.params.id) === req.user.id)
      return res.status(400).json({ error: 'Você não pode excluir sua própria conta' });
    await pool.query('DELETE FROM crm_users WHERE id=$1', [req.params.id]);
    res.json({ message: 'Usuário excluído' });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao excluir usuário' });
  }
});

module.exports = router;
