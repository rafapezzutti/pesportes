/**
 * CRUD de contatos de notificação de reservas por estabelecimento.
 * GET    /api/reservation-notif-contacts?est_id=X
 * POST   /api/reservation-notif-contacts
 * PATCH  /api/reservation-notif-contacts/:id
 * DELETE /api/reservation-notif-contacts/:id
 */
const router = require('express').Router();
const pool   = require('../db/pool');
const { auth, adminOrManager } = require('../middleware/auth');

function estScope(user, bodyEstId) {
  if (user.role === 'admin') return Number(bodyEstId) || null;
  return Number(user.est_id) || (user.est_ids && Number(user.est_ids[0])) || null;
}

// GET — lista contatos do estabelecimento
router.get('/', auth, adminOrManager, async (req, res) => {
  const est_id = estScope(req.user, req.query.est_id);
  if (!est_id) return res.json([]);
  try {
    const { rows } = await pool.query(
      `SELECT * FROM reservation_notif_contacts WHERE est_id=$1 ORDER BY nome`,
      [est_id]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao listar contatos' });
  }
});

// POST — cria contato
router.post('/', auth, adminOrManager, async (req, res) => {
  const { nome, telefone } = req.body;
  const est_id = estScope(req.user, req.body.est_id);
  if (!nome || !telefone || !est_id)
    return res.status(400).json({ error: 'nome, telefone e est_id são obrigatórios' });
  try {
    const { rows } = await pool.query(
      `INSERT INTO reservation_notif_contacts (est_id, nome, telefone) VALUES ($1,$2,$3) RETURNING *`,
      [est_id, nome.trim(), telefone.trim()]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao criar contato' });
  }
});

// PATCH — ativa/desativa
router.patch('/:id', auth, adminOrManager, async (req, res) => {
  const { ativo } = req.body;
  try {
    const { rows } = await pool.query(
      `UPDATE reservation_notif_contacts SET ativo=$1 WHERE id=$2 RETURNING *`,
      [ativo !== false, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Não encontrado' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao atualizar contato' });
  }
});

// DELETE — remove contato
router.delete('/:id', auth, adminOrManager, async (req, res) => {
  try {
    await pool.query(`DELETE FROM reservation_notif_contacts WHERE id=$1`, [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao remover contato' });
  }
});

module.exports = router;
