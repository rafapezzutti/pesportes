const nodemailer = require('nodemailer');

/**
 * Transporter Nodemailer via Gmail SMTP.
 * Configure as variáveis de ambiente:
 *   GMAIL_USER     → seu email Gmail (ex.: sistema@gmail.com)
 *   GMAIL_PASS     → Senha de App do Google (não a senha normal!)
 *     Para criar: myaccount.google.com → Segurança → Senhas de app
 */
function createTransporter() {
  return nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.GMAIL_USER,
      pass: process.env.GMAIL_PASS,
    },
  });
}

function fmtDate(d) {
  const [y, m, dd] = d.split('-');
  return `${dd}/${m}/${y}`;
}

function fmt$(v) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);
}

// ── Templates HTML ───────────────────────────────────────────────

function baseTemplate(title, body) {
  return `
<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"/>
<style>
  body { font-family: Arial, sans-serif; background: #f5f5f5; margin:0; padding:20px; }
  .box { max-width:560px; margin:auto; background:#fff; border-radius:12px; overflow:hidden; box-shadow:0 2px 12px rgba(0,0,0,.08); }
  .header { background: linear-gradient(135deg,#059669,#047857); padding:24px; text-align:center; }
  .header h1 { color:#fff; margin:0; font-size:20px; }
  .header p  { color:#a7f3d0; margin:4px 0 0; font-size:13px; }
  .body { padding:28px; }
  .row { display:flex; justify-content:space-between; padding:8px 0; border-bottom:1px solid #f0f0f0; font-size:14px; }
  .row:last-child { border:none; }
  .label { color:#6b7280; }
  .value { font-weight:600; color:#111827; text-align:right; }
  .total { background:#f0fdf4; border-radius:8px; padding:12px 16px; margin:16px 0; display:flex; justify-content:space-between; }
  .total .label { color:#065f46; font-weight:700; }
  .total .value { color:#059669; font-size:18px; font-weight:800; }
  .alert { background:#fffbeb; border-left:4px solid #f59e0b; padding:12px 16px; border-radius:4px; font-size:13px; color:#92400e; margin:16px 0; }
  .footer { padding:16px 28px; background:#f9fafb; text-align:center; font-size:12px; color:#9ca3af; }
  .btn { display:inline-block; background:#059669; color:#fff; text-decoration:none; padding:12px 28px; border-radius:8px; font-weight:700; margin:16px 0; }
</style></head><body>
<div class="box">
  <div class="header">
    <h1>P. Soluções Esportes &amp; Reservas</h1>
    <p>pesportes.ia.br</p>
  </div>
  <div class="body">
    <h2 style="margin-top:0;color:#111827">${title}</h2>
    ${body}
  </div>
  <div class="footer">© P. Soluções para Esportes &amp; Reservas · pesportes.ia.br</div>
</div>
</body></html>`;
}

function reservationRows(res) {
  return `
    <div class="row"><span class="label">Estabelecimento</span><span class="value">${res.est_name}</span></div>
    <div class="row"><span class="label">Espaço</span><span class="value">${res.point_name}</span></div>
    <div class="row"><span class="label">Data</span><span class="value">${fmtDate(typeof res.date === 'string' ? res.date : res.date.toISOString().split('T')[0])}</span></div>
    <div class="row"><span class="label">Horário</span><span class="value">${res.start_time} – ${res.end_time}</span></div>
    <div class="row"><span class="label">Endereço</span><span class="value">${res.street}, ${res.est_number} · ${res.city}/${res.state}</span></div>
    <div class="row"><span class="label">Telefone</span><span class="value">${res.est_phone || '—'}</span></div>
    <div class="total"><span class="label">Valor total</span><span class="value">${fmt$(res.total)}</span></div>
    <div class="alert">💳 Pagamento efetuado <strong>exclusivamente no local</strong> do estabelecimento.</div>
  `;
}

// ── Funções de envio ─────────────────────────────────────────────

async function sendConfirmationEmail(res, userEmail) {
  if (!process.env.GMAIL_USER) {
    console.log(`[EMAIL] Confirmação simulada para ${userEmail}`);
    return;
  }
  const html = baseTemplate('Reserva Confirmada ✅', `
    <p>Olá, <strong>${res.user_name}</strong>! Sua reserva foi confirmada com sucesso.</p>
    ${reservationRows(res)}
  `);
  await createTransporter().sendMail({
    from: `"P. Soluções Esportes" <${process.env.GMAIL_USER}>`,
    to: userEmail,
    subject: `✅ Reserva confirmada — ${res.point_name} em ${fmtDate(res.date)}`,
    html,
  });
}

async function sendCancellationEmail(res, userEmail) {
  if (!process.env.GMAIL_USER) {
    console.log(`[EMAIL] Cancelamento simulado para ${userEmail}`);
    return;
  }
  const html = baseTemplate('Reserva Cancelada', `
    <p>Olá, <strong>${res.user_name}</strong>. Sua reserva foi cancelada.</p>
    ${reservationRows(res)}
    <p style="color:#6b7280;font-size:13px">O horário voltou a ficar disponível para novas reservas.</p>
  `);
  await createTransporter().sendMail({
    from: `"P. Soluções Esportes" <${process.env.GMAIL_USER}>`,
    to: userEmail,
    subject: `Reserva cancelada — ${res.point_name}`,
    html,
  });
}

async function sendRescheduleEmail(res, userEmail) {
  if (!process.env.GMAIL_USER) {
    console.log(`[EMAIL] Remarcação simulada para ${userEmail}`);
    return;
  }
  const html = baseTemplate('Reserva Remarcada 📅', `
    <p>Olá, <strong>${res.user_name}</strong>. Sua reserva foi remarcada.</p>
    <p><strong>Novos dados:</strong></p>
    ${reservationRows(res)}
  `);
  await createTransporter().sendMail({
    from: `"P. Soluções Esportes" <${process.env.GMAIL_USER}>`,
    to: userEmail,
    subject: `Reserva remarcada — ${res.point_name} em ${fmtDate(res.date)}`,
    html,
  });
}

async function sendReminderEmail(res, type) {
  if (!process.env.GMAIL_USER) {
    console.log(`[EMAIL] Lembrete ${type} simulado para ${res.user_email}`);
    return;
  }
  const isPayment = type === '15min';
  const title = isPayment
    ? '⚠️ Lembrete de Pagamento — 15 minutos!'
    : '⏰ Lembrete: sua reserva começa em 1 hora';

  const extra = isPayment
    ? `<div class="alert">⚠️ <strong>Atenção:</strong> Você tem <strong>15 minutos</strong> para efetuar o pagamento no local. Sem o pagamento, o espaço pode ser liberado para outros.</div>`
    : `<div class="alert">🏃 Sua reserva começa em <strong>1 hora</strong>. Prepare-se!</div>`;

  const html = baseTemplate(title, `
    <p>Olá, <strong>${res.user_name}</strong>!</p>
    ${extra}
    ${reservationRows(res)}
  `);

  await createTransporter().sendMail({
    from: `"P. Soluções Esportes" <${process.env.GMAIL_USER}>`,
    to: res.user_email,
    subject: title,
    html,
  });
}

async function sendPasswordResetEmail(email, name, resetLink) {
  if (!process.env.GMAIL_USER) {
    console.log(`[EMAIL] Reset simulado para ${email}: ${resetLink}`);
    return;
  }
  const html = baseTemplate('Redefinição de Senha 🔑', `
    <p>Olá, <strong>${name}</strong>!</p>
    <p>Recebemos uma solicitação para redefinir a senha da sua conta.</p>
    <p style="text-align:center">
      <a href="${resetLink}" class="btn">Redefinir Minha Senha</a>
    </p>
    <p style="color:#6b7280;font-size:13px">O link expira em <strong>30 minutos</strong>. Se não foi você, ignore este email.</p>
  `);
  await createTransporter().sendMail({
    from: `"P. Soluções Esportes" <${process.env.GMAIL_USER}>`,
    to: email,
    subject: 'Redefinição de senha — P. Soluções Esportes',
    html,
  });
}

module.exports = {
  sendConfirmationEmail,
  sendCancellationEmail,
  sendRescheduleEmail,
  sendReminderEmail,
  sendPasswordResetEmail,
};
