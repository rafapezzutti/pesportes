const router = require('express').Router();
const pool = require('../db/pool');
const { auth, adminOnly, adminOrManager } = require('../middleware/auth');

// Campos públicos (visíveis no marketplace)
const PUBLIC_COLS = `id, name, street, number, complement, cep, city, state,
                     phone, photos, main_photo, operating_hours`;

// ── GET /api/establishments — lista pública ──────────────────────
router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT ${PUBLIC_COLS} FROM establishments ORDER BY name`
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao listar estabelecimentos' });
  }
});

// ── GET /api/establishments/:id ──────────────────────────────────
router.get('/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT ${PUBLIC_COLS} FROM establishments WHERE id = $1`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Não encontrado' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Erro interno' });
  }
});

// ── GET /api/establishments/:id/full — dados completos (CRM) ────
router.get('/:id/full', auth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM establishments WHERE id = $1`, [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Não encontrado' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Erro interno' });
  }
});

// ── POST /api/establishments — criar (admin) ─────────────────────
router.post('/', auth, adminOrManager, async (req, res) => {
  const {
    name, responsible, cpf_cnpj, street, number, complement,
    cep, city, state, phone, email, photos, main_photo, operating_hours
  } = req.body;

  if (!name || !responsible || !phone)
    return res.status(400).json({ error: 'Campos obrigatórios: name, responsible, phone' });

  try {
    const { rows } = await pool.query(`
      INSERT INTO establishments
        (name, responsible, cpf_cnpj, street, number, complement,
         cep, city, state, phone, email, photos, main_photo, operating_hours)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
      RETURNING *`,
      [name, responsible, cpf_cnpj, street, number, complement,
       cep, city, state, phone, email,
       photos || [], main_photo || null,
       JSON.stringify(operating_hours || {})]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao criar estabelecimento' });
  }
});

// ── PUT /api/establishments/:id — atualizar (admin) ─────────────
router.put('/:id', auth, adminOrManager, async (req, res) => {
  const {
    name, responsible, cpf_cnpj, street, number, complement,
    cep, city, state, phone, email, photos, main_photo, operating_hours
  } = req.body;

  try {
    const { rows } = await pool.query(`
      UPDATE establishments SET
        name=$1, responsible=$2, cpf_cnpj=$3, street=$4, number=$5,
        complement=$6, cep=$7, city=$8, state=$9, phone=$10, email=$11,
        photos=$12, main_photo=$13, operating_hours=$14, updated_at=NOW()
      WHERE id=$15 RETURNING *`,
      [name, responsible, cpf_cnpj, street, number, complement,
       cep, city, state, phone, email,
       photos || [], main_photo || null,
       JSON.stringify(operating_hours || {}),
       req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Não encontrado' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao atualizar estabelecimento' });
  }
});

module.exports = router;
