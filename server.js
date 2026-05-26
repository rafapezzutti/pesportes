require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const cron = require('node-cron');
const pool = require('./db/pool');
const { sendReminderEmail } = require('./services/email');

const app = express();
const PORT = process.env.PORT || 3000;

// ── Middleware ──────────────────────────────────────────────────
app.use(cors({
  origin: process.env.FRONTEND_URL || '*',
  credentials: true,
}));
app.use(express.json({ limit: '10mb' }));

// ── API Routes ──────────────────────────────────────────────────
app.use('/api/auth',             require('./routes/auth'));
app.use('/api/establishments',   require('./routes/establishments'));
app.use('/api/points',           require('./routes/points'));
app.use('/api/crm-users',        require('./routes/users'));
app.use('/api/reservations',     require('./routes/reservations'));
app.use('/api/dashboard',        require('./routes/dashboard'));
app.use('/api/professores',      require('./routes/professores'));
app.use('/api/planos',           require('./routes/planos'));
app.use('/api/bar',              require('./routes/bar'));
app.use('/api/manutencao',       require('./routes/manutencao'));
app.use('/api/profissionais-ef', require('./routes/profissionais_ef'));

// ── Healthcheck ─────────────────────────────────────────────────
app.get('/api/health', (req, res) => res.json({ status: 'ok', ts: new Date() }));

// ── Serve React frontend (produção) ─────────────────────────────
const DIST = path.join(__dirname, 'client', 'dist');
app.use(express.static(DIST));
app.get('*', (req, res) => {
  res.sendFile(path.join(DIST, 'index.html'));
});

// ── Cron Jobs — Lembretes de Reserva ────────────────────────────
cron.schedule('* * * * *', async () => {
  try {
    const now = new Date();
    const in60 = new Date(now.getTime() + 60 * 60 * 1000);
    const in15 = new Date(now.getTime() + 15 * 60 * 1000);

    const fmt = (d) => {
      const hh = String(d.getHours()).padStart(2, '0');
      const mm = String(d.getMinutes()).padStart(2, '0');
      return `${hh}:${mm}`;
    };

    for (const [target, type] of [[in60, '1h'], [in15, '15min']]) {
      const dateStr = target.toISOString().split('T')[0];
      const timeStr = fmt(target);

      const { rows } = await pool.query(`
        SELECT r.*, pu.name as user_name, pu.email as user_email,
               p.name as point_name, p.price_per_hour,
               e.name as est_name, e.phone as est_phone,
               e.street, e.number as est_number, e.city, e.state
        FROM reservations r
        JOIN public_users pu ON r.user_id = pu.id
        JOIN points p ON r.point_id = p.id
        JOIN establishments e ON r.est_id = e.id
        WHERE r.date = $1 AND r.start_time = $2 AND r.status = 'confirmed'
      `, [dateStr, timeStr]);

      for (const res of rows) {
        await sendReminderEmail(res, type);
      }
    }
  } catch (err) {
    console.error('[CRON] Erro nos lembretes:', err.message);
  }
});

// ── Start ────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`✅ Servidor rodando na porta ${PORT}`);
});
