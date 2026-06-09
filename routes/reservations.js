const router = require('express').Router();
const pool   = require('../db/pool');
const { auth, crmOnly, anyAuth } = require('../middleware/auth');
const {
  sendConfirmationEmail,
  sendCancellationEmail,
  sendRescheduleEmail,
} = require('../services/email');

const RES_QUERY = `
  SELECT r.*,
         COALESCE(pu.name,  r.client_name)       AS user_name,
         COALESCE(pu.email, r.client_email, '')   AS user_email,
         r.client_phone,
         p.name   AS point_name, p.price_per_hour,
         e.name   AS est_name,   e.phone AS est_phone,
         e.street, e.number AS est_number, e.city, e.state
  FROM reservations r
  LEFT JOIN public_users  pu ON r.user_id  = pu.id
  JOIN points         p ON r.point_id = p.id
  JOIN establishments e ON r.est_id   = e.id
`;

// GET /api/reservations
router.get('/', anyAuth, async (req, res) => {
  try {
    const { date, status, pointId } = req.query;
    const clauses = [];
    const params  = [];

    if (req.user.type === 'public') {
      clauses.push(`r.user_id = $${params.length + 1}`);
      params.push(req.user.id);
    }

    if (req.user.type === 'crm' && req.user.role === 'simples' && req.user.est_id) {
      clauses.push(`r.est_id = $${params.length + 1}`);
      params.push(req.user.est_id);
    }

    if (req.user.type === 'crm' && req.user.role === 'manager' && req.user.est_ids && req.user.est_ids.length > 0) {
      clauses.push(`r.est_id = ANY($${params.length + 1})`);
      params.push(req.user.est_ids);
    }

    if (date)    { clauses.push(`r.date = $${params.length+1}`);      params.push(date); }
    if (status)  { clauses.push(`r.status = $${params.length+1}`);    params.push(status); }
    if (pointId) { clauses.push(`r.point_id = $${params.length+1}`);  params.push(pointId); }

    const where = clauses.length ? 'WHERE ' + clauses.join(' AND ') : '';
    const { rows } = await pool.query(
      `${RES_QUERY} ${where} ORDER BY r.date DESC, r.start_time`,
      params
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao listar reservas' });
  }
});

// POST /api/reservations — usuario publico
router.post('/', auth, async (req, res) => {
  if (req.user.type !== 'public')
    return res.status(403).json({ error: 'Somente usuarios publicos podem reservar' });

  const { point_id, est_id, date, start_time, end_time, hours, payment_method } = req.body;
  if (!point_id || !est_id || !date || !start_time || !end_time || !hours)
    return res.status(400).json({ error: 'Campos obrigatorios faltando' });

  const pm = ['pix','credito','debito','dinheiro'].includes(payment_method) ? payment_method : 'dinheiro';

  try {
    const { rows: conflicts } = await pool.query(`
      SELECT id FROM reservations
      WHERE point_id=$1 AND date=$2 AND status != 'cancelled'
        AND start_time < $4 AND end_time > $3
    `, [point_id, date, start_time, end_time]);

    if (conflicts.length)
      return res.status(409).json({ error: 'Horario indisponivel' });

    const { rows: ptRows } = await pool.query(
      'SELECT price_per_hour FROM points WHERE id=$1', [point_id]
    );
    if (!ptRows.length) return res.status(404).json({ error: 'Ponto nao encontrado' });
    const total = ptRows[0].price_per_hour * hours;

    const { rows } = await pool.query(`
      INSERT INTO reservations (point_id, est_id, user_id, date, start_time, end_time, hours, total, payment_method)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [point_id, est_id, req.user.id, date, start_time, end_time, hours, total, pm]
    );

    const { rows: full } = await pool.query(`${RES_QUERY} WHERE r.id = $1`, [rows[0].id]);
    const reservation = full[0];

    sendConfirmationEmail(reservation, reservation.user_email).catch(console.error);
    res.status(201).json(reservation);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao criar reserva' });
  }
});

// POST /api/reservations/manual — CRM sem cadastro publico
router.post('/manual', auth, crmOnly, async (req, res) => {
  const { point_id, est_id, date, start_time, end_time, hours,
          payment_method, client_name, client_phone, client_email,
          participantes } = req.body;

  if (!point_id || !est_id || !date || !start_time || !end_time || !hours || !client_name || !client_phone)
    return res.status(400).json({ error: 'Nome e telefone do cliente sao obrigatorios' });

  try {
    const { rows: conflicts } = await pool.query(`
      SELECT id FROM reservations
      WHERE point_id=$1 AND date=$2 AND status != 'cancelled'
        AND start_time < $4 AND end_time > $3
    `, [point_id, date, start_time, end_time]);
    if (conflicts.length)
      return res.status(409).json({ error: 'Horario indisponivel' });

    const { rows: ptRows } = await pool.query(
      'SELECT price_per_hour FROM points WHERE id=$1', [point_id]
    );
    if (!ptRows.length) return res.status(404).json({ error: 'Ponto nao encontrado' });
    const total = ptRows[0].price_per_hour * hours;

    const pm = ['pix','credito','debito','dinheiro'].includes(payment_method) ? payment_method : 'dinheiro';

    // Normaliza participantes (máx 4, percentual automático se não informado)
    let parts = Array.isArray(participantes) ? participantes.slice(0, 4) : [];
    if (parts.length > 0) {
      const total_pct = parts.reduce((s, p) => s + (Number(p.percentual) || 0), 0);
      if (total_pct === 0) {
        const each = Math.round(100 / parts.length * 100) / 100;
        parts = parts.map(p => ({ ...p, percentual: each, status_pgto: 'pendente' }));
      }
    }

    const { rows } = await pool.query(`
      INSERT INTO reservations
        (point_id, est_id, user_id, date, start_time, end_time, hours, total,
         payment_method, client_name, client_phone, client_email, participantes)
      VALUES ($1,$2,NULL,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
      [point_id, est_id, date, start_time, end_time, hours, total, pm,
       client_name.trim(), client_phone.trim(), client_email ? client_email.trim() : null,
       JSON.stringify(parts)]
    );

    const { rows: full } = await pool.query(`${RES_QUERY} WHERE r.id = $1`, [rows[0].id]);
    res.status(201).json(full[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao criar reserva manual' });
  }
});

// PATCH /api/reservations/:id/participantes — atualiza lista de participantes
router.patch('/:id/participantes', auth, crmOnly, async (req, res) => {
  const { participantes } = req.body;
  try {
    let parts = Array.isArray(participantes) ? participantes.slice(0, 4) : [];
    const { rows } = await pool.query(
      'UPDATE reservations SET participantes = $1 WHERE id = $2 RETURNING id',
      [JSON.stringify(parts), req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Reserva não encontrada' });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao atualizar participantes' });
  }
});

// PATCH /api/reservations/:id/cancel
router.patch('/:id/cancel', anyAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(`${RES_QUERY} WHERE r.id = $1`, [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Reserva nao encontrada' });
    const res_ = rows[0];

    if (req.user.type === 'public') {
      if (res_.user_id !== req.user.id)
        return res.status(403).json({ error: 'Sem permissao' });
      const dt = new Date(`${res_.date}T${res_.start_time}:00`);
      const cutoff = new Date(dt.getTime() - 2 * 60 * 60 * 1000);
      if (new Date() >= cutoff)
        return res.status(400).json({ error: 'Prazo de cancelamento encerrado (2h antes)' });
    }

    await pool.query("UPDATE reservations SET status='cancelled' WHERE id=$1", [req.params.id]);
    sendCancellationEmail(res_, res_.user_email).catch(console.error);
    res.json({ message: 'Reserva cancelada' });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao cancelar reserva' });
  }
});

// PATCH /api/reservations/:id/reschedule
router.patch('/:id/reschedule', anyAuth, async (req, res) => {
  const { date, start_time, end_time, hours } = req.body;
  if (!date || !start_time || !end_time || !hours)
    return res.status(400).json({ error: 'Campos obrigatorios faltando' });

  try {
    const { rows } = await pool.query(`${RES_QUERY} WHERE r.id = $1`, [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Reserva nao encontrada' });
    const res_ = rows[0];

    if (req.user.type === 'public') {
      if (res_.user_id !== req.user.id)
        return res.status(403).json({ error: 'Sem permissao' });
      const dt = new Date(`${res_.date}T${res_.start_time}:00`);
      const cutoff = new Date(dt.getTime() - 2 * 60 * 60 * 1000);
      if (new Date() >= cutoff)
        return res.status(400).json({ error: 'Prazo de remarcacao encerrado (2h antes)' });
    }

    const { rows: conflicts } = await pool.query(`
      SELECT id FROM reservations
      WHERE point_id=$1 AND date=$2 AND status != 'cancelled' AND id != $3
        AND start_time < $5 AND end_time > $4
    `, [res_.point_id, date, req.params.id, start_time, end_time]);

    if (conflicts.length)
      return res.status(409).json({ error: 'Horario indisponivel no novo horario' });

    const total = res_.price_per_hour * hours;
    await pool.query(`
      UPDATE reservations SET date=$1, start_time=$2, end_time=$3, hours=$4, total=$5
      WHERE id=$6`,
      [date, start_time, end_time, hours, total, req.params.id]
    );

    const { rows: full } = await pool.query(`${RES_QUERY} WHERE r.id = $1`, [req.params.id]);
    sendRescheduleEmail(full[0], full[0].user_email).catch(console.error);
    res.json(full[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao remarcar reserva' });
  }
});

// PATCH /api/reservations/:id — status (CRM)
router.patch('/:id', auth, crmOnly, async (req, res) => {
  const { status } = req.body;
  if (!['confirmed','cancelled','completed'].includes(status))
    return res.status(400).json({ error: 'Status invalido' });

  try {
    const { rows } = await pool.query(
      `UPDATE reservations SET status=$1 WHERE id=$2 RETURNING id, status`,
      [status, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Nao encontrado' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao atualizar reserva' });
  }
});

module.exports = router;
