const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt    = require('jsonwebtoken');
const crypto = require('crypto');
const pool   = require('../db/pool');
const { sendPasswordResetEmail } = require('../services/email');

const sign = (payload) =>
  jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '30d' });

// Tabela de eventos de login (painel de atividade no Master) — autocria
pool.query(`CREATE TABLE IF NOT EXISTS login_events (
  id BIGSERIAL PRIMARY KEY, user_id INTEGER, user_name TEXT, user_role TEXT, ip TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
)`).catch(() => {});
pool.query('CREATE INDEX IF NOT EXISTS idx_login_events_created ON login_events(created_at DESC)').catch(() => {});
const logLogin = (req, id, nome, role) =>
  pool.query('INSERT INTO login_events (user_id, user_name, user_role, ip) VALUES ($1,$2,$3,$4)',
    [id, nome, role, (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.ip]).catch(() => {});

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

    // Fetch establishment features for non-admin users
    let estFeatures = null;
    if (user.role !== 'admin') {
      const estIds = Array.from(new Set([
        ...(user.est_ids || []),
        ...(user.est_id ? [user.est_id] : []),
      ])).map(Number).filter(Boolean);
      if (estIds.length) {
        const estRes = await pool.query(
          `SELECT COALESCE(features, '{}') AS features FROM establishments WHERE id = ANY($1)`,
          [estIds]
        );
        if (estRes.rows.length) {
          const allFeatures = estRes.rows.map(r => r.features || {});
          const allKeys = new Set(allFeatures.flatMap(f => Object.keys(f)));
          const merged = {};
          allKeys.forEach(k => {
            // Feature disabled only if ALL establishments have it explicitly disabled
            if (allFeatures.every(f => f[k] === false)) merged[k] = false;
          });
          estFeatures = merged;
        }
      }
    }

    const token = sign({
      id: user.id, role: user.role, type: 'crm',
      est_id: user.est_id || null,
      est_ids: user.est_ids || [],
      profissional_id: user.profissional_id || null,
      professor_id: user.professor_id || null,
    });
    logLogin(req, user.id, user.name, user.role);
    res.json({
      token,
      user: {
        id: user.id, name: user.name, email: user.email, role: user.role,
        est_id: user.est_id || null,
        est_ids: user.est_ids || [],
        profissional_id: user.profissional_id || null,
        professor_id: user.professor_id || null,
        estFeatures,
        permissions: user.permissions || null,
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
    logLogin(req, user.id, user.name, 'cliente');
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

// ── Impersonation (admin only) ────────────────────────────────────
const { auth: authMw, adminOnly } = require('../middleware/auth');

router.post('/impersonate', authMw, adminOnly, async (req, res) => {
  const { userId } = req.body;
  if (!userId) return res.status(400).json({ error: 'userId obrigatorio' });
  try {
    const { rows } = await pool.query(
      `SELECT id, name, email, role, est_id,
              COALESCE(est_ids, '{}') AS est_ids, profissional_id
       FROM crm_users WHERE id = $1`, [userId]
    );
    if (!rows.length) return res.status(404).json({ error: 'Usuário não encontrado' });
    const u = rows[0];
    const token = sign({
      id: u.id, role: u.role, type: 'crm',
      est_id: u.est_id || null,
      est_ids: u.est_ids || [],
      profissional_id: u.profissional_id || null,
      impersonated_by: req.user.id,
    });
    res.json({
      token,
      user: { id: u.id, name: u.name, email: u.email, role: u.role,
              est_id: u.est_id || null, est_ids: u.est_ids || [] },
    });
  } catch (err) {
    console.error('[impersonate]', err);
    res.status(500).json({ error: 'Erro ao impersonar usuário' });
  }
});

router.get('/crm-users-list', authMw, adminOnly, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT cu.id, cu.name, cu.email, cu.role,
              cu.est_id, cu.est_ids,
              e.name AS est_name
       FROM crm_users cu
       LEFT JOIN establishments e ON cu.est_id = e.id
       WHERE cu.role != 'admin'
       ORDER BY cu.role, cu.name`
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao listar usuários' });
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
