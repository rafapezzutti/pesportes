require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const cron = require('node-cron');
const pool = require('./db/pool');
const { sendReminderEmail, sendVacinaReminderEmail } = require('./services/email');
const auditLogger = require('./middleware/audit');

// ── Validação de variáveis de ambiente ──────────────────────────
const REQUIRED_ENV = ['DATABASE_URL', 'JWT_SECRET'];
const missing = REQUIRED_ENV.filter((k) => !process.env[k]);
if (missing.length) {
  console.error(`❌ Variáveis de ambiente obrigatórias ausentes: ${missing.join(', ')}`);
  process.exit(1);
}
if (!process.env.RESEND_API_KEY) {
  console.warn('⚠️  RESEND_API_KEY não configurada — e-mails não serão enviados.');
}

const app = express();
const PORT = process.env.PORT || 3000;
const TZ = process.env.TZ_RESERVAS || 'America/Sao_Paulo';

// ── Segurança ───────────────────────────────────────────────────
app.set('trust proxy', 1); // Render/Fly ficam atrás de proxy (IP real no rate limit)
app.use(helmet({ contentSecurityPolicy: false })); // CSP off p/ não quebrar o SPA

// CORS — em produção o SPA é servido pelo mesmo host (same-origin).
// Mantém allowlist para chamadas externas eventuais.
const allowlist = [process.env.FRONTEND_URL].filter(Boolean);
app.use(cors({
  origin: (origin, cb) => {
    if (!origin || allowlist.length === 0 || allowlist.includes(origin)) return cb(null, true);
    return cb(null, false);
  },
  credentials: true,
}));

app.use(express.json({ limit: '10mb' }));

// Rate limiting nas rotas de autenticação (anti brute-force)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 min
  max: 30,                  // 30 tentativas por IP por janela
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Muitas tentativas. Tente novamente em alguns minutos.' },
});
app.use('/api/auth', authLimiter);

// Auditoria — registra automaticamente todas as ações de escrita
app.use(auditLogger);

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
app.use('/api/audit',            require('./routes/audit'));
app.use('/api/repasse',          require('./routes/repasse'));
app.use('/api/expenses',         require('./routes/expenses'));
app.use('/api/finance',          require('./routes/finance'));
app.use('/api/reviews',          require('./routes/reviews'));
app.use('/api/bar-produtos',     require('./routes/bar_produtos'));
app.use('/api/reports',          require('./routes/reports'));
app.use('/api/employees',        require('./routes/employees'));
app.use('/api/ponto',            require('./routes/ponto'));
app.use('/api/alunos',           require('./routes/alunos'));
app.use('/api/vacinas',          require('./routes/vacinas'));

// ── Healthcheck ─────────────────────────────────────────────────
app.get('/api/health', (req, res) => res.json({ status: 'ok', ts: new Date() }));

// ── Serve React frontend (produção) ─────────────────────────────
const DIST = path.join(__dirname, 'client', 'dist');
app.use(express.static(DIST));
app.get('*', (req, res) => {
  res.sendFile(path.join(DIST, 'index.html'));
});

// ── Cron — Lembretes de Reserva ─────────────────────────────────
// Roda a cada 5 min. Usa flags reminded_1h / reminded_15m para nunca
// perder um lembrete (mesmo de horários "quebrados") e nunca repetir.
// Interpreta o horário da reserva no fuso configurado (BR por padrão).
cron.schedule('*/5 * * * *', async () => {
  try {
    // Só consulta o banco em horário comercial (7h–23h BRT) para o Neon
    // poder dormir (scale-to-zero) durante a madrugada e reduzir custo.
    const brHour = Number(new Intl.DateTimeFormat('en-US', {
      hour: 'numeric', hour12: false, timeZone: TZ,
    }).format(new Date()));
    if (brHour < 7 || brHour >= 23) return;

    const { rows } = await pool.query(`
      SELECT r.*,
             pu.name  AS user_name,
             pu.email AS user_email,
             p.name   AS point_name, p.price_per_hour,
             e.name   AS est_name, e.phone AS est_phone,
             e.street, e.number AS est_number, e.city, e.state,
             EXTRACT(EPOCH FROM (
               ((r.date + r.start_time::time) AT TIME ZONE $1) - NOW()
             )) / 60 AS mins_until
      FROM reservations r
      JOIN public_users pu  ON r.user_id  = pu.id
      JOIN points p         ON r.point_id = p.id
      JOIN establishments e ON r.est_id   = e.id
      WHERE r.status = 'confirmed'
        AND ((r.date + r.start_time::time) AT TIME ZONE $1)
              BETWEEN NOW() AND NOW() + INTERVAL '70 minutes'
        AND (r.reminded_1h = FALSE OR r.reminded_15m = FALSE)
    `, [TZ]);

    for (const r of rows) {
      const mins = Number(r.mins_until);
      try {
        if (mins <= 15 && !r.reminded_15m) {
          await sendReminderEmail(r, '15min');
          await pool.query(
            'UPDATE reservations SET reminded_15m = TRUE, reminded_1h = TRUE WHERE id = $1',
            [r.id]
          );
        } else if (mins <= 60 && !r.reminded_1h) {
          await sendReminderEmail(r, '1h');
          await pool.query('UPDATE reservations SET reminded_1h = TRUE WHERE id = $1', [r.id]);
        }
      } catch (err) {
        console.error(`[CRON] Falha ao lembrar reserva ${r.id}:`, err.message);
      }
    }
  } catch (err) {
    console.error('[CRON] Erro nos lembretes:', err.message);
  }
});

// ── Cron — Lembretes de Vacina (diário às 8h BRT) ───────────────────
// Envia email ao aluno quando data_proxima_dose = hoje ou amanhã.
// Marca lembrete_enviado = TRUE para não repetir.
cron.schedule('0 8 * * *', async () => {
  try {
    const { rows } = await pool.query(`
      SELECT v.*,
             a.nome  AS aluno_nome,
             a.email AS aluno_email,
             e.name  AS est_name
      FROM aluno_vacinas v
      JOIN alunos        a ON v.aluno_id = a.id
      LEFT JOIN establishments e ON v.est_id = e.id
      WHERE v.lembrete_enviado = FALSE
        AND a.email IS NOT NULL
        AND v.data_proxima_dose BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '1 day'
    `);
    for (const v of rows) {
      try {
        await sendVacinaReminderEmail(v);
        await pool.query(
          'UPDATE aluno_vacinas SET lembrete_enviado = TRUE, updated_at = NOW() WHERE id = $1',
          [v.id]
        );
        console.log(`[VACINA] Lembrete enviado para ${v.aluno_email} — ${v.nome_vacina}`);
      } catch (err) {
        console.error(`[VACINA] Falha ao enviar lembrete id=${v.id}:`, err.message);
      }
    }
  } catch (err) {
    console.error('[VACINA CRON] Erro:', err.message);
  }
}, { timezone: 'America/Sao_Paulo' });

// ── Auto-migrate: garante tabelas e colunas novas no startup ────────
async function runMigrations() {
  const stmts = [
    `CREATE TABLE IF NOT EXISTS alunos (
      id              SERIAL PRIMARY KEY,
      nome            TEXT NOT NULL,
      cpf             TEXT,
      email           TEXT,
      data_nascimento DATE,
      est_id          INTEGER REFERENCES establishments(id) ON DELETE SET NULL,
      ativo           BOOLEAN DEFAULT TRUE,
      created_at      TIMESTAMPTZ DEFAULT NOW(),
      updated_at      TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE INDEX IF NOT EXISTS idx_alunos_nome   ON alunos(nome)`,
    `CREATE INDEX IF NOT EXISTS idx_alunos_est_id ON alunos(est_id)`,
    `ALTER TABLE bar_vendas        ADD COLUMN IF NOT EXISTS foto        TEXT`,
    `ALTER TABLE bar_vendas        ADD COLUMN IF NOT EXISTS status_pgto TEXT DEFAULT 'pendente'`,
    `ALTER TABLE bar_vendas        ADD COLUMN IF NOT EXISTS forma_pgto  TEXT`,
    `ALTER TABLE manutencao_vendas ADD COLUMN IF NOT EXISTS status_pgto TEXT DEFAULT 'pendente'`,
    `ALTER TABLE manutencao_vendas ADD COLUMN IF NOT EXISTS forma_pgto  TEXT`,
    `ALTER TABLE reservations      ADD COLUMN IF NOT EXISTS status_pgto TEXT DEFAULT 'pendente'`,
    `ALTER TABLE reservations      ADD COLUMN IF NOT EXISTS forma_pgto  TEXT`,
    `ALTER TABLE reservations      ADD COLUMN IF NOT EXISTS participantes JSONB DEFAULT '[]'`,
    `ALTER TABLE planos_aula       ADD COLUMN IF NOT EXISTS status_pgto TEXT DEFAULT 'pendente'`,
    `ALTER TABLE planos_aula       ADD COLUMN IF NOT EXISTS forma_pgto  TEXT`,
    `ALTER TABLE alunos            ADD COLUMN IF NOT EXISTS telefone    TEXT`,
    `CREATE TABLE IF NOT EXISTS aluno_vacinas (
      id                SERIAL PRIMARY KEY,
      aluno_id          INTEGER NOT NULL REFERENCES alunos(id) ON DELETE CASCADE,
      est_id            INTEGER REFERENCES establishments(id) ON DELETE SET NULL,
      nome_vacina       TEXT NOT NULL,
      data_aplicacao    DATE,
      data_proxima_dose DATE,
      observacoes       TEXT,
      lembrete_enviado  BOOLEAN DEFAULT FALSE,
      created_at        TIMESTAMPTZ DEFAULT NOW(),
      updated_at        TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE INDEX IF NOT EXISTS idx_aluno_vacinas_aluno   ON aluno_vacinas(aluno_id)`,
    `CREATE INDEX IF NOT EXISTS idx_aluno_vacinas_proxima ON aluno_vacinas(data_proxima_dose)`,
  ];
  for (const sql of stmts) {
    await pool.query(sql).catch((e) =>
      console.warn('[migrate]', e.message.split('\n')[0])
    );
  }
  console.log('✅ Migrações automáticas aplicadas');
}

// ── Start ────────────────────────────────────────────────────────
runMigrations().then(() => {
  app.listen(PORT, () => {
    console.log(`✅ Servidor rodando na porta ${PORT}`);
  });
}).catch((err) => {
  console.error('❌ Falha crítica nas migrações:', err);
  process.exit(1);
});
