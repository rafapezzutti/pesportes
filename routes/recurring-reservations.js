const router = require('express').Router();
const pool   = require('../db/pool');
const { auth, crmOnly } = require('../middleware/auth');

// GET /api/recurring-reservations
router.get('/', auth, crmOnly, async (req, res) => {
  try {
    const clauses = [];
    const params  = [];

    if (req.user.role === 'simples' && req.user.est_id) {
      clauses.push(`rr.est_id = $${params.length + 1}`);
      params.push(req.user.est_id);
    } else if (req.user.role === 'manager' && req.user.est_ids?.length) {
      clauses.push(`rr.est_id = ANY($${params.length + 1})`);
      params.push(req.user.est_ids);
    }

    const where = clauses.length ? 'WHERE ' + clauses.join(' AND ') : '';
    const { rows } = await pool.query(`
      SELECT rr.*,
             e.name AS est_name,
             p.name AS point_name, p.price_per_hour
      FROM recurring_reservations rr
      JOIN establishments e ON rr.est_id   = e.id
      JOIN points         p ON rr.point_id = p.id
      ${where}
      ORDER BY rr.ativo DESC, rr.created_at DESC
    `, params);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao listar recorrências' });
  }
});

// POST /api/recurring-reservations
router.post('/', auth, crmOnly, async (req, res) => {
  const {
    est_id, point_id, day_of_week, start_time, end_time, hours,
    client_name, client_phone, client_email,
    participantes, payment_method, start_date, observacoes,
  } = req.body;

  if (!est_id || !point_id || day_of_week == null || !start_time || !end_time || !client_name) {
    return res.status(400).json({ error: 'Campos obrigatórios: estabelecimento, ponto, dia da semana, horário e nome do cliente' });
  }

  // Normaliza participantes
  let parts = Array.isArray(participantes) ? participantes.slice(0, 4) : [];
  if (parts.length > 0) {
    const total_pct = parts.reduce((s, p) => s + (Number(p.percentual) || 0), 0);
    if (total_pct === 0) {
      const each = Math.round(100 / parts.length * 100) / 100;
      parts = parts.map(p => ({ ...p, percentual: each }));
    }
  }

  try {
    const { rows } = await pool.query(`
      INSERT INTO recurring_reservations
        (est_id, point_id, day_of_week, start_time, end_time, hours,
         client_name, client_phone, client_email,
         participantes, payment_method, start_date, observacoes, created_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
      RETURNING *
    `, [
      est_id, point_id, Number(day_of_week), start_time, end_time, hours || 1,
      client_name.trim(), client_phone || null, client_email || null,
      JSON.stringify(parts), payment_method || 'dinheiro',
      start_date || null, observacoes || null, req.user.id,
    ]);
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao criar recorrência' });
  }
});

// PATCH /api/recurring-reservations/:id
router.patch('/:id', auth, crmOnly, async (req, res) => {
  const allowed = [
    'est_id','point_id','day_of_week','start_time','end_time','hours',
    'client_name','client_phone','client_email',
    'participantes','payment_method','start_date','observacoes','ativo',
  ];
  const updates = [];
  const params  = [];

  for (const f of allowed) {
    if (req.body[f] !== undefined) {
      updates.push(`${f} = $${params.length + 1}`);
      params.push(f === 'participantes' ? JSON.stringify(req.body[f]) : req.body[f]);
    }
  }
  if (!updates.length) return res.status(400).json({ error: 'Nenhum campo para atualizar' });

  params.push(req.params.id);
  try {
    const { rows } = await pool.query(
      `UPDATE recurring_reservations SET ${updates.join(', ')} WHERE id = $${params.length} RETURNING *`,
      params
    );
    if (!rows.length) return res.status(404).json({ error: 'Não encontrado' });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao atualizar recorrência' });
  }
});

// DELETE /api/recurring-reservations/:id
router.delete('/:id', auth, crmOnly, async (req, res) => {
  try {
    await pool.query('DELETE FROM recurring_reservations WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao remover recorrência' });
  }
});

// POST /api/recurring-reservations/:id/generate/:year/:month
// Gera reservas para o mês e retorna dados da fatura
router.post('/:id/generate/:year/:month', auth, crmOnly, async (req, res) => {
  const { id, year, month } = req.params;
  const y = parseInt(year);
  const m = parseInt(month); // 1-12

  if (!y || !m || m < 1 || m > 12) {
    return res.status(400).json({ error: 'Mês/ano inválidos' });
  }

  try {
    // Busca a recorrência com preço
    const { rows: rrRows } = await pool.query(`
      SELECT rr.*, p.price_per_hour, e.name AS est_name, p.name AS point_name
      FROM recurring_reservations rr
      JOIN points         p ON rr.point_id = p.id
      JOIN establishments e ON rr.est_id   = e.id
      WHERE rr.id = $1
    `, [id]);
    if (!rrRows.length) return res.status(404).json({ error: 'Recorrência não encontrada' });
    const rr = rrRows[0];

    // Calcular todas as datas do day_of_week no mês
    // day_of_week: 0=Dom, 1=Seg, 2=Ter, 3=Qua, 4=Qui, 5=Sex, 6=Sab
    const daysInMonth = new Date(y, m, 0).getDate();
    const allDates = [];
    for (let d = 1; d <= daysInMonth; d++) {
      const dt = new Date(y, m - 1, d);
      if (dt.getDay() === rr.day_of_week) {
        const ds = `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
        // Respeita start_date se configurada
        const startDateStr = rr.start_date
          ? (typeof rr.start_date === 'string' ? rr.start_date.split('T')[0] : rr.start_date.toISOString().split('T')[0])
          : null;
        if (!startDateStr || ds >= startDateStr) {
          allDates.push(ds);
        }
      }
    }

    const created  = [];
    const skipped  = [];
    const existing = [];

    for (const date of allDates) {
      // Verificar se já existe reserva recorrente para este dia
      const { rows: existingRec } = await pool.query(
        'SELECT id FROM reservations WHERE recurring_id=$1 AND date=$2',
        [id, date]
      );
      if (existingRec.length) { existing.push(date); continue; }

      // Verificar conflito com outra reserva
      const { rows: conflicts } = await pool.query(`
        SELECT id FROM reservations
        WHERE point_id=$1 AND date=$2 AND status != 'cancelled'
          AND start_time < $4 AND end_time > $3
      `, [rr.point_id, date, rr.start_time, rr.end_time]);
      if (conflicts.length) { skipped.push(date); continue; }

      const total = rr.price_per_hour * rr.hours;

      // Normaliza participantes
      let parts = Array.isArray(rr.participantes) ? rr.participantes : [];
      try { if (typeof rr.participantes === 'string') parts = JSON.parse(rr.participantes); } catch {}

      await pool.query(`
        INSERT INTO reservations
          (point_id, est_id, user_id, date, start_time, end_time, hours, total,
           payment_method, client_name, client_phone, client_email,
           participantes, recurring_id)
        VALUES ($1,$2,NULL,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
      `, [
        rr.point_id, rr.est_id, date, rr.start_time, rr.end_time, rr.hours, total,
        rr.payment_method, rr.client_name, rr.client_phone || null, rr.client_email || null,
        JSON.stringify(parts), id,
      ]);
      created.push(date);
    }

    const pricePerSession = rr.price_per_hour * rr.hours;
    // Total considera todas as datas do mês (incluindo existing já geradas antes)
    const allSessionDates = [...allDates]; // para calcular fatura completa
    const invoiceDates    = [...created, ...existing].sort();

    // Busca todas as reservas do mês para montar fatura
    const { rows: resRows } = await pool.query(
      `SELECT id, date, start_time, end_time, total FROM reservations
       WHERE recurring_id=$1 AND date >= $2 AND date <= $3
       ORDER BY date`,
      [id,
       `${y}-${String(m).padStart(2,'0')}-01`,
       `${y}-${String(m).padStart(2,'0')}-${String(daysInMonth).padStart(2,'0')}`]
    );

    const sessions = resRows.length;
    const totalBilling = pricePerSession * allDates.length;

    // Breakdown por participante
    let parts = Array.isArray(rr.participantes) ? rr.participantes : [];
    try { if (typeof rr.participantes === 'string') parts = JSON.parse(rr.participantes); } catch {}

    const participantesBreakdown = parts.map(p => ({
      nome: p.nome,
      percentual: Number(p.percentual) || Math.round(100 / parts.length),
      valor: totalBilling * (Number(p.percentual) || Math.round(100 / parts.length)) / 100,
    }));

    res.json({
      recurring: {
        id: rr.id,
        client_name:    rr.client_name,
        client_phone:   rr.client_phone,
        est_name:       rr.est_name,
        point_name:     rr.point_name,
        day_of_week:    rr.day_of_week,
        start_time:     rr.start_time,
        end_time:       rr.end_time,
        hours:          rr.hours,
        price_per_hour: rr.price_per_hour,
        payment_method: rr.payment_method,
      },
      year: y,
      month: m,
      dates_all:    allDates,
      dates_created: created,
      dates_existing: existing,
      dates_skipped:  skipped,
      reservations:   resRows,
      sessions,
      price_per_session: pricePerSession,
      total: totalBilling,
      participantes: participantesBreakdown,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
