const router  = require('express').Router();
const bcrypt  = require('bcryptjs');
const pool    = require('../db/pool');
const { auth, adminOnly } = require('../middleware/auth');

// Campos públicos retornados no marketplace
const PUBLIC_FIELDS = `
  id, nome, cref, especialidade, bio, foto, foto_x, foto_y, phone, email, site,
  street, number, complement, cep, city, state,
  valor_hora, aceita_avulso, aceita_mensal, operating_hours
`;

// ── GET /public — lista profissionais visíveis no marketplace (sem auth) ──────
router.get('/public', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT ${PUBLIC_FIELDS}
       FROM profissionais_ef
       WHERE marketplace_visible = TRUE AND ativo = TRUE
       ORDER BY nome`
    );
    res.json(rows);
  } catch (err) {
    console.error('[GET /profissionais-ef/public]', err);
    res.status(500).json({ error: 'Erro interno' });
  }
});

// ── GET /:id/public — detalhe público de um profissional (sem auth) ───────────
router.get('/:id/public', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT ${PUBLIC_FIELDS}
       FROM profissionais_ef
       WHERE id = $1 AND marketplace_visible = TRUE AND ativo = TRUE`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Profissional não encontrado' });
    res.json(rows[0]);
  } catch (err) {
    console.error('[GET /profissionais-ef/:id/public]', err);
    res.status(500).json({ error: 'Erro interno' });
  }
});

// ── GET / — lista todos (admin) ───────────────────────────────────────────────
router.get('/', auth, adminOnly, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM profissionais_ef ORDER BY nome`
    );
    res.json(rows);
  } catch (err) {
    console.error('[GET /profissionais-ef]', err);
    res.status(500).json({ error: 'Erro interno' });
  }
});

// ── POST / — cria profissional + crm_user de login (admin) ───────────────────
router.post('/', auth, adminOnly, async (req, res) => {
  const {
    nome, cref, especialidade, bio, foto, foto_x, foto_y, phone, email, site,
    street, number, complement, cep, city, state,
    valor_hora, aceita_avulso, aceita_mensal, marketplace_visible,
    operating_hours,
    login_email, login_password,
  } = req.body;

  if (!nome) return res.status(400).json({ error: 'Campo nome é obrigatório' });
  if (!login_email || !login_password)
    return res.status(400).json({ error: 'login_email e login_password são obrigatórios' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Verificar se login_email já existe em crm_users
    const existing = await client.query(
      'SELECT id FROM crm_users WHERE email = $1',
      [login_email.toLowerCase()]
    );
    if (existing.rows.length) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Email de login já cadastrado em crm_users' });
    }

    // Criar profissional_ef
    const { rows: profRows } = await client.query(
      `INSERT INTO profissionais_ef
         (nome, cref, especialidade, bio, foto, foto_x, foto_y, phone, email, site,
          street, number, complement, cep, city, state,
          valor_hora, aceita_avulso, aceita_mensal, marketplace_visible, operating_hours)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
       RETURNING *`,
      [
        nome, cref || null, especialidade || null, bio || null, foto || null,
        foto_x ?? 50, foto_y ?? 30,
        phone || null, email || null, site || null,
        street || null, number || null, complement || null, cep || null,
        city || null, state || null,
        valor_hora ?? 0,
        aceita_avulso !== undefined ? aceita_avulso : true,
        aceita_mensal !== undefined ? aceita_mensal : false,
        marketplace_visible !== undefined ? marketplace_visible : false,
        operating_hours ? JSON.stringify(operating_hours) : '{}',
      ]
    );
    const profissional = profRows[0];

    // Criar crm_user com role='profissional'
    const password_hash = await bcrypt.hash(login_password, 10);
    const { rows: userRows } = await client.query(
      `INSERT INTO crm_users (name, email, password_hash, role, profissional_id)
       VALUES ($1, $2, $3, 'profissional', $4)
       RETURNING id, name, email, role, profissional_id`,
      [nome, login_email.toLowerCase(), password_hash, profissional.id]
    );

    await client.query('COMMIT');
    res.status(201).json({ profissional, crm_user: userRows[0] });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[POST /profissionais-ef]', err);
    res.status(500).json({ error: 'Erro interno' });
  } finally {
    client.release();
  }
});

// ── PUT /:id — atualiza (admin OU profissional dono) ─────────────────────────
router.put('/:id', auth, async (req, res) => {
  // Verificar permissão inline
  const isAdmin = req.user?.role === 'admin';
  const isOwner = req.user?.type === 'crm' && Number(req.user?.profissional_id) === Number(req.params.id);
  if (!isAdmin && !isOwner) {
    return res.status(403).json({ error: 'Acesso restrito' });
  }

  const {
    nome, cref, especialidade, bio, foto, foto_x, foto_y, phone, email, site,
    street, number, complement, cep, city, state,
    valor_hora, aceita_avulso, aceita_mensal, marketplace_visible,
    operating_hours, ativo,
  } = req.body;

  try {
    const { rows } = await pool.query(
      `UPDATE profissionais_ef SET
         nome               = COALESCE($1, nome),
         cref               = COALESCE($2, cref),
         especialidade      = COALESCE($3, especialidade),
         bio                = COALESCE($4, bio),
         foto               = COALESCE($5, foto),
         foto_x             = COALESCE($6, foto_x),
         foto_y             = COALESCE($7, foto_y),
         phone              = COALESCE($8, phone),
         email              = COALESCE($9, email),
         site               = COALESCE($10, site),
         street             = COALESCE($11, street),
         number             = COALESCE($12, number),
         complement         = COALESCE($13, complement),
         cep                = COALESCE($14, cep),
         city               = COALESCE($15, city),
         state              = COALESCE($16, state),
         valor_hora         = COALESCE($17, valor_hora),
         aceita_avulso      = COALESCE($18, aceita_avulso),
         aceita_mensal      = COALESCE($19, aceita_mensal),
         marketplace_visible = COALESCE($20, marketplace_visible),
         operating_hours    = COALESCE($21, operating_hours),
         ativo              = COALESCE($22, ativo),
         updated_at         = NOW()
       WHERE id = $23
       RETURNING *`,
      [
        nome || null, cref || null, especialidade || null, bio || null, foto || null,
        foto_x !== undefined ? foto_x : null,
        foto_y !== undefined ? foto_y : null,
        phone || null, email || null, site || null,
        street || null, number || null, complement || null, cep || null,
        city || null, state || null,
        valor_hora !== undefined ? valor_hora : null,
        aceita_avulso !== undefined ? aceita_avulso : null,
        aceita_mensal !== undefined ? aceita_mensal : null,
        marketplace_visible !== undefined ? marketplace_visible : null,
        operating_hours !== undefined ? JSON.stringify(operating_hours) : null,
        ativo !== undefined ? ativo : null,
        req.params.id,
      ]
    );
    if (!rows.length) return res.status(404).json({ error: 'Profissional não encontrado' });
    res.json(rows[0]);
  } catch (err) {
    console.error('[PUT /profissionais-ef/:id]', err);
    res.status(500).json({ error: 'Erro interno' });
  }
});

// ── DELETE /:id — deleta (admin) ──────────────────────────────────────────────
router.delete('/:id', auth, adminOnly, async (req, res) => {
  try {
    const { rowCount } = await pool.query(
      'DELETE FROM profissionais_ef WHERE id = $1',
      [req.params.id]
    );
    if (!rowCount) return res.status(404).json({ error: 'Profissional não encontrado' });
    res.json({ message: 'Profissional removido com sucesso' });
  } catch (err) {
    console.error('[DELETE /profissionais-ef/:id]', err);
    res.status(500).json({ error: 'Erro interno' });
  }
});

module.exports = router;
