const router = require('express').Router();
const pool = require('../db/pool');
const { auth, adminOnly } = require('../middleware/auth');

// ── GET /api/points?estId=1 ──────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const { estId } = req.query;
    let query = 'SELECT * FROM points';
    const params = [];
    if (estId) { query += ' WHERE est_id = $1'; params.push(estId); }
    query += ' ORDER BY name';
    const { rows } = await pool.query(query, params);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao listar pontos' });
  }
});

// ── GET /api/points/:id ──────────────────────────────────────────
router.get('/:id', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM points WHERE id=$1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Não encontrado' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Erro interno' });
  }
});

// ── GET /api/points/:id/slots?date=YYYY-MM-DD ────────────────────
router.get('/:id/slots', async (req, res) => {
  const { date } = req.query;
  if (!date) return res.status(400).json({ error: 'Parâmetro date obrigatório' });

  try {
    // Busca o ponto e o estabelecimento
    const { rows: ptRows } = await pool.query(
      'SELECT p.*, e.operating_hours as est_hours FROM points p JOIN establishments e ON p.est_id = e.id WHERE p.id = $1',
      [req.params.id]
    );
    if (!ptRows.length) return res.status(404).json({ error: 'Ponto não encontrado' });
    const pt = ptRows[0];

    // Determina horários efetivos
    const hours = pt.custom_hours || pt.est_hours;
    const dayMap = ['dom','seg','ter','qua','qui','sex','sab'];
    const dk = dayMap[new Date(date + 'T12:00:00').getDay()];
    const dayHours = hours[dk];

    if (!dayHours || !dayHours.open) return res.json([]);

    const [sh] = dayHours.start.split(':').map(Number);
    const [eh] = dayHours.end.split(':').map(Number);

    // Reservas existentes neste dia/ponto
    const { rows: resList } = await pool.query(
      `SELECT start_time, end_time FROM reservations
       WHERE point_id=$1 AND date=$2 AND status != 'cancelled'`,
      [req.params.id, date]
    );

    const now = new Date();
    const todayStr = now.toISOString().split('T')[0];
    const slots = [];

    for (let h = sh; h < eh; h++) {
      const t = `${String(h).padStart(2,'0')}:00`;
      // Ignora horários passados no dia atual
      if (date === todayStr) {
        const slotDt = new Date(`${date}T${t}:00`);
        if (slotDt <= now) continue;
      }
      const taken = resList.some(r => r.start_time <= t && t < r.end_time);
      slots.push({ time: t, available: !taken });
    }

    res.json(slots);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao buscar horários' });
  }
});

// ── POST /api/points — criar (admin) ────────────────────────────
router.post('/', auth, adminOnly, async (req, res) => {
  const { est_id, type, name, price_per_hour, custom_hours } = req.body;
  if (!est_id || !type || !name || !price_per_hour)
    return res.status(400).json({ error: 'Campos obrigatórios faltando' });

  try {
    const { rows } = await pool.query(
      `INSERT INTO points (est_id, type, name, price_per_hour, custom_hours)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [est_id, type, name, price_per_hour, custom_hours ? JSON.stringify(custom_hours) : null]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao criar ponto' });
  }
});

// ── PUT /api/points/:id — atualizar (admin) ──────────────────────
router.put('/:id', auth, adminOnly, async (req, res) => {
  const { type, name, price_per_hour, custom_hours } = req.body;
  try {
    const { rows } = await pool.query(
      `UPDATE points SET type=$1, name=$2, price_per_hour=$3, custom_hours=$4
       WHERE id=$5 RETURNING *`,
      [type, name, price_per_hour, custom_hours ? JSON.stringify(custom_hours) : null, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Não encontrado' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao atualizar ponto' });
  }
});

// ── DELETE /api/points/:id — excluir (admin) ─────────────────────
router.delete('/:id', auth, adminOnly, async (req, res) => {
  try {
    await pool.query('DELETE FROM points WHERE id=$1', [req.params.id]);
    res.json({ message: 'Ponto excluído' });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao excluir ponto' });
  }
});

module.exports = router;
