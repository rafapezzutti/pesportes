const router = require('express').Router();
const pool = require('../db/pool');
const { auth, adminOnly, adminOrManager } = require('../middleware/auth');

// Helper: verifica se o gerente tem acesso ao est_id informado
function managerOwnsEst(user, est_id) {
  if (user.role === 'admin') return true;
  const ids = [...(user.est_ids || []), ...(user.est_id ? [user.est_id] : [])].map(Number);
  return ids.includes(Number(est_id));
}

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

// ── POST /api/points — criar (admin ou gerente do est) ──────────
router.post('/', auth, adminOrManager, async (req, res) => {
  const { est_id, type, name, price_per_hour, price_per_hour_aluno, custom_hours } = req.body;
  if (!est_id || !type || !name || !price_per_hour)
    return res.status(400).json({ error: 'Campos obrigatórios faltando' });
  if (!managerOwnsEst(req.user, est_id))
    return res.status(403).json({ error: 'Sem acesso a este estabelecimento' });

  try {
    const { rows } = await pool.query(
      `INSERT INTO points (est_id, type, name, price_per_hour, price_per_hour_aluno, custom_hours)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [est_id, type, name, price_per_hour, price_per_hour_aluno || null, custom_hours ? JSON.stringify(custom_hours) : null]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao criar ponto' });
  }
});

// ── PUT /api/points/:id — atualizar (admin ou gerente do est) ────
router.put('/:id', auth, adminOrManager, async (req, res) => {
  const { type, name, price_per_hour, price_per_hour_aluno, custom_hours } = req.body;
  try {
    const { rows: cur } = await pool.query('SELECT est_id FROM points WHERE id=$1', [req.params.id]);
    if (!cur.length) return res.status(404).json({ error: 'Não encontrado' });
    if (!managerOwnsEst(req.user, cur[0].est_id))
      return res.status(403).json({ error: 'Sem acesso a este estabelecimento' });

    const { rows } = await pool.query(
      `UPDATE points SET type=$1, name=$2, price_per_hour=$3, price_per