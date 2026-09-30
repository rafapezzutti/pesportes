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

// Desliga todas as notificações de reserva sem precisar de deploy:
// no Render, defina RES_NOTIF_DISABLED=1 e reinicie.
const DISABLED = () => process.env.RES_NOTIF_DISABLED === '1';

/**
 * Enfileira uma mensagem para todos os contatos de notificação do estabelecimento.
 * Ignora se a MESMA mensagem para o MESMO telefone já foi enfileirada nos últimos 10 min
 * (evita rajadas de mensagens idênticas por duplo clique / saves repetidos).
 * Silencioso — nunca lança erro para não afetar o fluxo principal.
 */
async function enqueue(est_id, message) {
  if (!est_id || !message || DISABLED()) return;
  try {
    const { rows: contacts } = await pool.query(
      `SELECT DISTINCT telefone FROM reservation_notif_contacts WHERE est_id=$1 AND ativo=TRUE`,
      [est_id]
    );
    for (const c of contacts) {
      await pool.query(
        `INSERT INTO reservation_notif_queue (est_id, telefone, message)
         SELECT $1, $2, $3
         WHERE NOT EXISTS (
           SELECT 1 FROM reservation_notif_queue
           WHERE telefone = $2 AND message = $3
             AND created_at > NOW() - INTERVAL '10 minutes'
         )`,
        [est_id, c.telefone, message]
      );
    }
  } catch (e) {
    console.error('[reservation-notif] enqueue error:', e.message);
  }
}

let running = false;

/**
 * Processa a fila: envia no máximo 1 mensagem por telefone a cada 60s.
 * - `running` impede execuções sobrepostas no mesmo servidor (cron de 30s).
 * - O "claim" é um único UPDATE atômico: se houver 2 instâncias do servidor
 *   (ex.: durante deploy no Render), cada linha só é pega por uma delas.
 * - A linha é marcada como enviada ANTES do envio, então nunca é reenviada.
 */
async function processQueue() {
  if (running || DISABLED()) return;
  running = true;
  try {
    const { rows: items } = await pool.query(`
      WITH next AS (
        SELECT DISTINCT ON (q.telefone) q.id
        FROM reservation_notif_queue q
        WHERE q.sent_at IS NULL
          AND NOT EXISTS (
            SELECT 1 FROM reservation_notif_queue s
            WHERE s.telefone = q.telefone
              AND s.sent_at > NOW() - INTERVAL '60 seconds'
          )
        ORDER BY q.telefone, q.created_at ASC, q.id ASC
      )
      UPDATE reservation_notif_queue q
         SET sent_at = NOW()
        FROM next
       WHERE q.id = next.id AND q.sent_at IS NULL
      RETURNING q.*`);

    for (const item of items) {
      // Mensagens muito antigas (ex.: acumuladas com WhatsApp desconectado) são descartadas
      if (Date.now() - new Date(item.created_at).getTime() > 6 * 60 * 60 * 1000) {
        console.log(`[reservation-notif] descartada (antiga) id=${item.id} para ${item.telefone}`);
        continue;
      }
      try {
        await sendText(item.telefone, item.message, instanceForEst(item.est_id));
        console.log(`[reservation-notif] enviado id=${item.id} para ${item.telefone} (est ${item.est_id})`);
      } catch (e) {
        console.error(`[reservation-notif] erro ao enviar id=${item.id} para ${item.telefone}:`, e.message);
      }
    }
  } catch (e) {
    console.error('[reservation-notif] processQueue error:', e.message);
  } finally {
    running = false;
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
