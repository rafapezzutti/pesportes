const router = require('express').Router();
const pool   = require('../db/pool');
const { auth } = require('../middleware/auth');

/**
 * GET /api/horarios-livres?estId=&pointIds=1,2,3&from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * Retorna matriz de disponibilidade:
 * {
 *   points: [{id, name, type}],
 *   days:   ['2026-07-01', ...],
 *   slots:  { pointId: { date: { '08:00': true/false, ... } } }
 * }
 * true = LIVRE, false = OCUPADO
 */
router.get('/', auth, async (req, res) => {
  const { estId, pointIds, from, to } = req.query;
  if (!estId || !from || !to)
    return res.status(400).json({ error: 'estId, from e to são obrigatórios' });

  try {
    // 1. Resolve which points to query
    let ptFilter = 'p.est_id = $1';
    const ptParams = [estId];
    const ids = pointIds ? pointIds.split(',').map(Number).filter(Boolean) : [];
    if (ids.length) {
      ptFilter += ` AND p.id = ANY($2)`;
      ptParams.push(ids);
    }

    const { rows: points } = await pool.query(
      `SELECT p.id, p.name, p.type, p.custom_hours,
              e.operating_hours AS est_hours,
              COALESCE(e.slot_interval, 60) AS slot_interval
       FROM points p
       JOIN establishments e ON p.est_id = e.id
       WHERE ${ptFilter}
       ORDER BY p.name`,
      ptParams
    );

    if (!points.length) return res.json({ points: [], days: [], slots: {} });

    // 2. All reservations for these points in the period
    const pointIdList = points.map(p => p.id);
    const { rows: reservations } = await pool.query(
      `SELECT point_id, date, start_time, end_time
       FROM reservations
       WHERE point_id = ANY($1)
         AND date >= $2 AND date <= $3
         AND status != 'cancelled'`,
      [pointIdList, from, to]
    );

    // 3. Build day list
    const days = [];
    const cur = new Date(from + 'T12:00:00');
    const end = new Date(to   + 'T12:00:00');
    while (cur <= end) {
      days.push(cur.toISOString().split('T')[0]);
      cur.setDate(cur.getDate() + 1);
    }

    // 4. Index reservations: resIdx[pointId][date] = [{start, end}]
    const resIdx = {};
    for (const r of reservations) {
      const ds = typeof r.date === 'string' ? r.date.split('T')[0] : r.date.toISOString().split('T')[0];
      if (!resIdx[r.point_id]) resIdx[r.point_id] = {};
      if (!resIdx[r.point_id][ds]) resIdx[r.point_id][ds] = [];
      resIdx[r.point_id][ds].push({ start: r.start_time, end: r.end_time });
    }

    const dayMap = ['dom','seg','ter','qua','qui','sex','sab'];

    // 5. Build slots matrix
    const slots = {};
    for (const pt of points) {
      slots[pt.id] = {};
      const hours = pt.custom_hours || pt.est_hours || {};

      for (const day of days) {
        const dk = dayMap[new Date(day + 'T12:00:00').getDay()];
        const dayHours = hours[dk];
        if (!dayHours || !dayHours.open) {
          slots[pt.id][day] = {}; // closed
          continue;
        }

        const [sh, sm = 0] = dayHours.start.split(':').map(Number);
        const [eh, em = 0] = dayHours.end.split(':').map(Number);
        const startMin = sh * 60 + sm;
        const endMin   = eh * 60 + em;
        const interval = pt.slot_interval || 60;
        const occupied = resIdx[pt.id]?.[day] || [];

        // helper: "HH:MM" → minutes
        const toMin = t => { const [hh,mm=0] = t.split(':').map(Number); return hh*60+mm; };

        slots[pt.id][day] = {};
        for (let m = startMin; m < endMin; m += interval) {
          const hh = String(Math.floor(m/60)).padStart(2,'0');
          const mm = String(m % 60).padStart(2,'0');
          const t = `${hh}:${mm}`;
          const slotEnd = m + interval;
          // slot is taken if any reservation overlaps [m, slotEnd)
          const isTaken = occupied.some(r => toMin(r.start) < slotEnd && toMin(r.end) > m);
          slots[pt.id][day][t] = !isTaken; // true = livre
        }
      }
    }

    res.json({ points: points.map(p => ({ id: p.id, name: p.name, type: p.type, slot_interval: p.slot_interval })), days, slots });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao calcular horários livres' });
  }
});

module.exports = router;
