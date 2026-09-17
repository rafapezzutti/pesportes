/**
 * Serviço de notificações WhatsApp para eventos de reserva.
 *
 * Fluxo:
 *   1. enqueue(est_id, message) — insere 1 linha por contato ativo do est na fila
 *   2. processQueue()           — chamado pelo cron a cada 30s
 *                                 envia 1 mensagem por telefone/minuto
 */
const pool    = require('../db/pool');
const { sendText, instanceForEst } = require('./whatsapp');

/**
 * Enfileira uma mensagem para todos os contatos de notificação do estabelecimento.
 * Silencioso — nunca lança erro para não afetar o fluxo principal.
 */
async function enqueue(est_id, message) {
  if (!est_id || !message) return;
  try {
    const { rows: contacts } = await pool.query(
      `SELECT telefone FROM reservation_notif_contacts WHERE est_id=$1 AND ativo=TRUE`,
      [est_id]
    );
    if (!contacts.length) return;
    for (const c of contacts) {
      await pool.query(
        `INSERT INTO reservation_notif_queue (est_id, telefone, message) VALUES ($1,$2,$3)`,
        [est_id, c.telefone, message]
      );
    }
  } catch (e) {
    console.error('[reservation-notif] enqueue error:', e.message);
  }
}

/**
 * Processa a fila: para cada telefone com mensagens pendentes,
 * envia a próxima se passaram pelo menos 60s desde o último envio.
 * Chamado pelo cron a cada 30s.
 */
async function processQueue() {
  try {
    // Telefones distintos com mensagens pendentes
    const { rows: phones } = await pool.query(
      `SELECT DISTINCT telefone, est_id FROM reservation_notif_queue WHERE sent_at IS NULL`
    );
    if (!phones.length) return;

    const now = new Date();

    for (const { telefone, est_id } of phones) {
      // Último envio para esse telefone
      const { rows: ls } = await pool.query(
        `SELECT MAX(sent_at) AS last FROM reservation_notif_queue
         WHERE telefone=$1 AND sent_at IS NOT NULL`,
        [telefone]
      );
      const last = ls[0]?.last;
      if (last && (now - new Date(last)) < 60000) continue; // < 60s, aguarda

      // Próxima mensagem pendente para esse telefone
      const { rows: pending } = await pool.query(
        `SELECT * FROM reservation_notif_queue
         WHERE telefone=$1 AND sent_at IS NULL
         ORDER BY created_at ASC LIMIT 1`,
        [telefone]
      );
      if (!pending.length) continue;

      const item = pending[0];

      // Marca como enviada antes de tentar (evita duplos em falha transitória)
      await pool.query(
        `UPDATE reservation_notif_queue SET sent_at=NOW() WHERE id=$1`,
        [item.id]
      );

      try {
        const instance = instanceForEst(item.est_id);
        await sendText(item.telefone, item.message, instance);
        console.log(`[reservation-notif] enviado para ${item.telefone} (est ${item.est_id})`);
      } catch (e) {
        console.error(`[reservation-notif] erro ao enviar para ${item.telefone}:`, e.message);
      }
    }
  } catch (e) {
    console.error('[reservation-notif] processQueue error:', e.message);
  }
}

/** Formata data DD/MM/AAAA */
function fmtDate(d) {
  if (!d) return '—';
  let dateOnly;
  if (d instanceof Date) {
    // node-pg retorna DATE como objeto Date (UTC midnight)
    dateOnly = d.toISOString().slice(0, 10);
  } else {
    // string "2026-09-17" ou "2026-09-17T03:00:00.000Z"
    dateOnly = String(d).slice(0, 10);
  }
  const dt = new Date(dateOnly + 'T12:00:00');
  if (isNaN(dt.getTime())) return String(d); // fallback: retorna o valor bruto
  return dt.toLocaleDateString('pt-BR');
}

/** Formata hora HH:MM */
function fmtTime(t) {
  return t ? String(t).slice(0, 5) : '—';
}

const DAYS_PT = ['Domingo','Segunda','Terça','Quarta','Quinta','Sexta','Sábado'];

/**
 * Monta mensagem de nova reserva avulsa.
 */
function msgNova(r) {
  const nome   = r.user_name || r.client_name || '—';
  const quadra = r.point_name || '—';
  const data   = fmtDate(r.date);
  const inicio = fmtTime(r.start_time);
  const fim    = fmtTime(r.end_time);
  const feita  = r.crm_user_name ? `\n🖊️ Cadastrada por: ${r.crm_user_name}` : '';
  return `📅 *Nova Reserva*\n👤 ${nome}\n🏟️ ${quadra}\n📆 ${data}\n⏰ ${inicio} – ${fim}${feita}`;
}

/**
 * Monta mensagem de reserva alterada.
 */
function msgAlterada(r) {
  const nome   = r.user_name || r.client_name || '—';
  const quadra = r.point_name || '—';
  const data   = fmtDate(r.date);
  const inicio = fmtTime(r.start_time);
  const fim    = fmtTime(r.end_time);
  const feita  = r.crm_user_name ? `\n🖊️ Alterada por: ${r.crm_user_name}` : '';
  return `✏️ *Reserva Alterada*\n👤 ${nome}\n🏟️ ${quadra}\n📆 ${data}\n⏰ ${inicio} – ${fim}${feita}`;
}

/**
 * Monta mensagem de cancelamento.
 * @param {object} r - dados da reserva
 * @param {string|null} cancelledBy - nome do usuário CRM que cancelou (opcional)
 */
function msgCancelada(r, cancelledBy) {
  const nome   = r.user_name || r.client_name || '—';
  const quadra = r.point_name || '—';
  const data   = fmtDate(r.date);
  const inicio = fmtTime(r.start_time);
  const fim    = fmtTime(r.end_time);
  const por    = cancelledBy ? `\n🖊️ Cancelada por: ${cancelledBy}` : '';
  return `❌ *Reserva Cancelada*\n👤 ${nome}\n🏟️ ${quadra}\n📆 ${data}\n⏰ ${inicio} – ${fim}${por}`;
}

/**
 * Monta mensagem de recorrente criada (uma única vez).
 */
function msgRecorrente(r) {
  const nome   = r.client_name || '—';
  const quadra = r.point_name || r.point_id || '—';
  const dia    = DAYS_PT[r.day_of_week] || '—';
  const inicio = fmtTime(r.start_time);
  const fim    = fmtTime(r.end_time);
  const horario = fim && fim !== '—' ? `${inicio} – ${fim}` : inicio;
  return `🔁 *Reserva Recorrente Criada*\n👤 ${nome}\n🏟️ ${quadra}\n📅 Toda ${dia}\n⏰ ${horario}`;
}

module.exports = { enqueue, processQueue, msgNova, msgAlterada, msgCancelada, msgRecorrente };
