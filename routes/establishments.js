const router = require('express').Router();
const pool = require('../db/pool');
const jwt   = require('jsonwebtoken');
const { auth, adminOnly, adminOrManager } = require('../middleware/auth');

const PUBLIC_COLS = `id, name, street, number, complement, cep, city, state,
                     phone, site, photos, main_photo, operating_hours, unimidia_divulgacao, aulas`;

// GET /api/establishments
// — Público (marketplace): retorna todos
// — CRM admin: retorna todos
// — CRM manager/simples: retorna apenas os est_ids vinculados ao usuário
router.get('/', async (req, res) => {
  try {
    const header = req.headers.authorization;
    if (header && header.startsWith('Bearer ')) {
      try {
        const payload = jwt.verify(header.slice(7), process.env.JWT_SECRET);
        if (payload.type === 'crm' && payload.role !== 'admin') {
          // Coleta todos os ids vinculados ao usuário
          const ids = Array.from(new Set([
            ...(payload.est_ids || []),
            ...(payload.est_id ? [payload.est_id] : []),
          ])).map(Number).filter(Boolean);
          if (!ids.length) return res.json([]);
          const { rows } = await pool.query(
            `SELECT ${PUBLIC_COLS} FROM establishments WHERE id = ANY($1) ORDER BY name`,
            [ids]
          );
          return res.json(rows);
        }
      } catch { /* token inválido → trata como público */ }
    }
    // Admin ou sem token (marketplace público)
    const { rows } = await pool.query(
      `SELECT ${PUBLIC_COLS} FROM establishments ORDER BY name`
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao listar estabelecimentos' });
  }
});

// GET /api/establishments/admin/features — admin: todos os est com features
router.get('/admin/features', auth, adminOnly, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, name, city, state, COALESCE(features, '{}') AS features
       FROM establishments ORDER BY name`
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao listar' });
  }
});

// GET /api/establishments/:id
router.get('/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT ${PUBLIC_COLS} FROM establishments WHERE id = $1`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Nao encontrado' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Erro interno' });
  }
});

// GET /api/establishments/:id/full — dados completos (CRM)
router.get('/:id/full', auth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM establishments WHERE id = $1`, [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Nao encontrado' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Erro interno' });
  }
});

// POST /api/establishments — criar
router.post('/', auth, adminOrManager, async (req, res) => {
  const {
    name, responsible, cpf_cnpj, street, number, complement,
    cep, city, state, phone, email, site, photos, main_photo,
    operating_hours, unimidia_divulgacao, aulas
  } = req.body;

  if (!name || !responsible || !phone)
    return res.status(400).json({ error: 'Campos obrigatorios: name, responsible, phone' });

  try {
    const { rows } = await pool.query(`
      INSERT INTO establishments
        (name, responsible, cpf_cnpj, street, number, complement,
         cep, city, state, phone, email, site, photos, main_photo,
         operating_hours, unimidia_divulgacao, aulas)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
      RETURNING *`,
      [name, responsible, cpf_cnpj, street, number, complement,
       cep, city, state, phone, email, site || null,
       photos || [], main_photo || null,
       JSON.stringify(operating_hours || {}),
       unimidia_divulgacao === true || unimidia_divulgacao === 'true',
       aulas === true || aulas === 'true']
    );
    const newEst = rows[0];

    // Auto-vincula ao gerente que criou
    if (req.user.role === 'manager') {
      await pool.query(
        `UPDATE crm_users
         SET est_ids = array_append(COALESCE(est_ids, '{}'), $1)
         WHERE id = $2`,
        [newEst.id, req.user.id]
      );
    }

    res.status(201).json(newEst);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao criar estabelecimento' });
  }
});

// PUT /api/establishments/:id — atualizar
router.put('/:id', auth, adminOrManager, async (req, res) => {
  const {
    name, responsible, cpf_cnpj, street, number, complement,
    cep, city, state, phone, email, site, photos, main_photo,
    operating_hours, unimidia_divulgacao, aulas
  } = req.body;

  try {
    const { rows } = await pool.query(`
      UPDATE establishments SET
        name=$1, responsible=$2, cpf_cnpj=$3, street=$4, number=$5,
        complement=$6, cep=$7, city=$8, state=$9, phone=$10, email=$11,
        site=$12, photos=$13, main_photo=$14, operating_hours=$15,
        unimidia_divulgacao=$16, aulas=$17, updated_at=NOW()
      WHERE id=$18 RETURNING *`,
      [name, responsible, cpf_cnpj, street, number, complement,
       cep, city, state, phone, email, site || null,
       photos || [], main_photo || null,
       JSON.stringify(operating_hours || {}),
       unimidia_divulgacao === true || unimidia_divulgacao === 'true',
       aulas === true || aulas === 'true',
       req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Nao encontrado' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao atualizar estabelecimento' });
  }
});

// PUT /api/establishments/:id/features — admin: atualiza entitlements
router.put('/:id/features', auth, adminOnly, async (req, res) => {
  const { features } = req.body;
  if (!features || typeof features !== 'object')
    return res.status(400).json({ error: 'features deve ser um objeto' });
  try {
    const { rows } = await pool.query(
      `UPDATE establishments SET features = $1, updated_at = NOW()
       WHERE id = $2 RETURNING id, name, COALESCE(features, '{}') AS features`,
      [JSON.stringify(features), req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Nao encontrado' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao atualizar entitlements' });
  }
});


module.exports = router;
