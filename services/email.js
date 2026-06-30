const { Resend } = require('resend');

/**
 * Serviço de e-mail usando Resend.com
 * Configure a variável de ambiente:
 *   RESEND_API_KEY  → chave de API do Resend (https://resend.com/api-keys)
 *   RESEND_FROM     → remetente verificado, ex.: "P. Soluções <noreply@pesportes.ia.br>"
 *                     Se não configurado, usa o domínio sandbox do Resend (só envia ao próprio email)
 */

function getResend() {
  return new Resend(process.env.RESEND_API_KEY);
}

const FROM = process.env.RESEND_FROM || 'P. Soluções Esportes <onboarding@resend.dev>';

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
<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<style>
  body { font-family: Arial, sans-serif; background: #f5f5f5; margin:0; padding:20px; }
  .btn { display:inline-block; background:#059669; color:#fff !important; text-decoration:none; padding:12px 28px; border-radius:8px; font-weight:700; margin:16px 0; }
</style>
</head>
<body>
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:20px 0;">
  <tr><td align="center">
    <table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.08);">
      <!-- header -->
      <tr><td style="background:linear-gradient(135deg,#059669,#047857);padding:24px;text-align:center;">
        <h1 style="color:#fff;margin:0;font-size:20px;">P. Soluções Esportes &amp; Reservas</h1>
        <p style="color:#a7f3d0;margin:4px 0 0;font-size:13px;">pesportes.ia.br</p>
      </td></tr>
      <!-- body -->
      <tr><td style="padding:28px;">
        <h2 style="margin:0 0 20px;color:#111827;">${title}</h2>
        ${body}
      </td></tr>
      <!-- footer -->
      <tr><td style="padding:16px 28px;background:#f9fafb;text-align:center;font-size:12px;color:#9ca3af;">
        © P. Soluções para Esportes &amp; Reservas · pesportes.ia.br
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;
}

function reservationRows(res) {
  const date = typeof res.date === 'string' ? res.date : res.date.toISOString().split('T')[0];
  const row = (label, value) => `
    <tr>
      <td style="padding:9px 0;border-bottom:1px solid #f0f0f0;font-size:14px;color:#6b7280;width:40%;vertical-align:top;">${label}</td>
      <td style="padding:9px 0 9px 12px;border-bottom:1px solid #f0f0f0;font-size:14px;font-weight:600;color:#111827;text-align:right;">${value}</td>
    </tr>`;
  return `
    <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-bottom:16px;">
      ${row('Estabelecimento', res.est_name)}
      ${row('Espaço', res.point_name)}
      ${row('Data', fmtDate(date))}
      ${row('Horário', `${res.start_time} – ${res.end_time}`)}
      ${row('Endereço', `${res.street}, ${res.est_number} · ${res.city}/${res.state}`)}
      ${row('Telefone', res.est_phone || '—')}
    </table>
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#f0fdf4;border-radius:8px;margin-bottom:16px;">
      <tr>
        <td style="padding:12px 16px;color:#065f46;font-weight:700;font-size:14px;">Valor total</td>
        <td style="padding:12px 16px;color:#059669;font-size:18px;font-weight:800;text-align:right;">${fmt$(res.total)}</td>
      </tr>
    </table>
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#fffbeb;border-left:4px solid #f59e0b;border-radius:4px;margin-bottom:16px;">
      <tr><td style="padding:12px 16px;font-size:13px;color:#92400e;">
        💳 Pagamento efetuado <strong>exclusivamente no local</strong> do estabelecimento.
      </td></tr>
    </table>
  `;
}

// ── Helpers de envio ─────────────────────────────────────────────

async function send({ to, subject, html }) {
  if (!process.env.RESEND_API_KEY) {
    console.log(`[EMAIL SIMULADO] Para: ${to} | Assunto: ${subject}`);
    return;
  }
  const resend = getResend();
  const { error } = await resend.emails.send({ from: FROM, to, subject, html });
  if (error) throw new Error(error.message);
}

// ── Funções de envio ─────────────────────────────────────────────

async function sendConfirmationEmail(res, userEmail) {
  if (!userEmail) return;
  const html = baseTemplate('Reserva Confirmada ✅', `
    <p>Olá, <strong>${res.user_name}</strong>! Sua reserva foi confirmada com sucesso.</p>
    ${reservationRows(res)}
  `);
  await send({
    to: userEmail,
    subject: `✅ Reserva confirmada — ${res.point_name} em ${fmtDate(typeof res.date === 'string' ? res.date : res.date.toISOString().split('T')[0])}`,
    html,
  });
}

async function sendCancellationEmail(res, userEmail) {
  if (!userEmail) return;
  const html = baseTemplate('Reserva Cancelada', `
    <p>Olá, <strong>${res.user_name}</strong>. Sua reserva foi cancelada.</p>
    ${reservationRows(res)}
    <p style="color:#6b7280;font-size:13px">O horário voltou a ficar disponível para novas reservas.</p>
  `);
  await send({
    to: userEmail,
    subject: `Reserva cancelada — ${res.point_name}`,
    html,
  });
}

async function sendRescheduleEmail(res, userEmail) {
  if (!userEmail) return;
  const html = baseTemplate('Reserva Remarcada 📅', `
    <p>Olá, <strong>${res.user_name}</strong>. Sua reserva foi remarcada.</p>
    <p><strong>Novos dados:</strong></p>
    ${reservationRows(res)}
  `);
  await send({
    to: userEmail,
    subject: `Reserva remarcada — ${res.point_name} em ${fmtDate(typeof res.date === 'string' ? res.date : res.date.toISOString().split('T')[0])}`,
    html,
  });
}

async function sendReminderEmail(res, type) {
  if (!res.user_email) return;
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

  await send({ to: res.user_email, subject: title, html });
}

async function sendPasswordResetEmail(email, name, resetLink) {
  const html = baseTemplate('Redefinição de Senha 🔑', `
    <p>Olá, <strong>${name}</strong>!</p>
    <p>Recebemos uma solicitação para redefinir a senha da sua conta em <strong>P. Soluções Esportes &amp; Reservas</strong>.</p>
    <p style="text-align:center;margin:24px 0">
      <a href="${resetLink}" class="btn">🔑 Redefinir Minha Senha</a>
    </p>
    <p style="color:#6b7280;font-size:13px">⏱️ O link expira em <strong>30 minutos</strong>.</p>
    <p style="color:#6b7280;font-size:13px">Se você não solicitou a redefinição de senha, ignore este e-mail — sua senha permanece a mesma.</p>
  `);
  await send({
    to: email,
    subject: '🔑 Redefinição de senha — P. Soluções Esportes',
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
