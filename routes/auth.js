const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt    = require('jsonwebtoken');
const crypto = require('crypto');
const pool   = require('../db/pool');
const { sendPasswordResetEmail } = require('../services/email');

const sign = (payload) =>
  jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '7d' });

// CRM Login
router.post('/crm/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password)
    return res.status(400).json({ error: 'Email e senha obrigatorios' });

  try {
    const { rows } = await pool.query(
      'SELECT * FROM crm_users WHERE email = $1', [email.toLowerCase()]
    );
    const user = rows[0];
    if (!user || !(await bcrypt.compare(password, user.password_hash)))
      return res.status(401).json({ error: 'Email ou senha invalidos' });

    const token = sign({
      id: user.id, role: user.role, type: 'crm',
      est_id: user.est_id || null,
      est_ids: user.est_ids || [],
      profissional_id: user.profissional_id || null,
    });
    res.json({
      token,
      user: {
        id: user.id, name: user.name, email: user.email, role: user.role,
        est_id: user.est_id || null,
        est_ids: user.est_ids || [],
        profissional_id: user.profissional_id || null,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro interno' });
  }
});

// Public Login
router.post('/public/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password)
    return res.status(400).json({ error: 'Email e senha obrigatorios' });

  try {
    const { rows } = await pool.query(
      'SELECT * FROM public_users WHERE email = $1', [email.toLowerCase()]
    );
    const user = rows[0];
    if (!user || !(await bcrypt.compare(password, user.password_hash)))
      return res.status(401).json({ error: 'Email ou senha invalidos' });

    const token = sign({ id: user.id, type: 'public' });
    res.json({
      token,
      user: { id: user.id, name: user.name, email: user.email, cpf: user.cpf },
    });
  } catch (err) {
    res.status(500).json({ error: 'Erro interno' });
  }
});

// Public Register
router.post('/public/register', async (req, res) => {
  const { name, cpf, email, password } = req.body;
  if (!name || !email || !password)
    return res.status(400).json({ error: 'Campos obrigatorios faltando' });
  if (password.length < 6)
    return res.status(400).json({ error: 'Senha deve ter ao menos 6 caracteres' });

  try {
    const exists = await pool.query(
      'SELECT id FROM public_users WHERE email = $1', [email.toLowerCase()]
    );
    if (exists.rows.length)
      return res.status(409).json({ error: 'Email ja cadastrado' });

    const hash = await bcrypt.hash(password, 10);
    const { rows } = await pool.query(
      `INSERT INTO public_users (name, cpf, email, password_hash)
       VALUES ($1, $2, $3, $4) RETURNING id, name, email, cpf`,
      [name, cpf || null, email.toLowerCase(), hash]
    );
    const user = rows[0];
    const token = sign({ id: user.id, type: 'public' });
    res.status(201).json({ token, user });
  } catch (err) {
    res.status(500).json({ error: 'Erro interno' });
  }
});

// Forgot Password
router.post('/forgot-password', async (req, res) => {
  const { email, type = 'public' } = req.body;
  if (!email) return res.status(400).json({ error: 'Email obrigatorio' });

  try {
    const table = type === 'crm' ? 'crm_users' : 'public_users';
    const { rows } = await pool.query(
      `SELECT id, name, email FROM ${table} WHERE email = $1`,
      [email.toLowerCase()]
    );
    if (!rows.length) return res.json({ message: 'Se o email existir, um link foi enviado.' });

    const user = rows[0];
    const token = crypto.randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + 30 * 60 * 1000);

    await pool.query(
      `UPDATE ${table} SET reset_token = $1, reset_expires = $2 WHERE id = $3`,
      [token, expires, user.id]
    );

    const resetLink = `${process.env.FRONTEND_URL || 'https://pesportes.ia.br'}/reset-password?token=${token}&type=${type}`;
    await sendPasswordResetEmail(user.email, user.name, resetLink);
    res.json({ message: 'Se o email existir, um link foi enviado.' });
  } catch (err) {
    console.error('[forgot-password] Falha ao enviar email:', err);
    res.status(500).json({ error: 'Erro ao enviar email de recuperacao' });
  }
});

// Reset Password
router.post('/reset-password', async (req, res) => {
  const { token, password, type = 'public' } = req.body;
  if (!token || !password)
    return res.status(400).json({ error: 'Token e senha obrigatorios' });
  if (password.length < 6)
    return res.status(400).json({ error: 'Senha deve ter ao menos 6 caracteres' });

  try {
    const table = type === 'crm' ? 'crm_users' : 'public_users';
    const { rows } = await pool.query(
      `SELECT id FROM ${table} WHERE reset_token = $1 AND reset_expires > NOW()`,
      [token]
    );
    if (!rows.length)
      return res.status(400).json({ error: 'Token invalido ou expirado' });

    const hash = await bcrypt.hash(password, 10);
    await pool.query(
      `UPDATE ${table} SET password_hash = $1, reset_token = NULL, reset_expires = NULL WHERE id = $2`,
      [hash, rows[0].id]
    );
    res.json({ message: 'Senha redefinida com sucesso' });
  } catch (err) {
    res.status(500).json({ error: 'Erro interno' });
  }
});

// Me
router.get('/me', async (req, res) => {
  const header = req.headers.authorization;
  if (!header) return res.status(401).json({ error: 'Nao autenticado' });
  try {
    const payload = jwt.verify(header.slice(7), process.env.JWT_SECRET);
    let rows;
    if (payload.type === 'crm') {
      const r = await pool.query(
        `SELECT id, name, email, role, est_id, COALESCE(est_ids, '{}') AS est_ids, profissional_id
         FROM crm_users WHERE id = $1`, [payload.id]
      );
      rows = r.rows;
    } else {
      const r = await pool.query(
        `SELECT id, name, email, cpf FROM public_users WHERE id = $1`, [payload.id]
      );
      rows = r.rows;
    }
    if (!rows.length) return res.status(404).json({ error: 'Usuario nao encontrado' });
    res.json({ user: rows[0], type: payload.type });
  } catch {
    res.status(401).json({ error: 'Token invalido' });
  }
});

module.exports = router;
