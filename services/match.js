/**
 * Match — alunos cadastrados registram a intenção de jogar e o sistema forma
 * grupos (simples = 2, dupla = 4) com mesmo clube, modalidade, formato e nível
 * e horários que se sobrepõem. Toda comunicação sai pelo WhatsApp do clube.
 *
 * Ciclo do grupo:
 *   formado → (aluno pede a quadra) pre_reservado → (clube) confirmado | recusado
 *   formado/pre_reservado sem ação a tempo → expirado
 *   participante desiste → cancelado
 */
const pool = require('../db/pool');
const { enqueueTo, enqueue } = require('./reservation-notif');

const SITE = (process.env.FRONTEND_URL || 'https://pesportes.ia.br').replace(/\/$/, '');
const TAM = { simples: 2, dupla: 4 };
const NIVEIS = ['iniciante', 'intermediario', 'avancado'];
const NIVEL_LABEL = { iniciante: 'Iniciante', intermediario: 'Intermediário', avancado: 'Avançado' };
const DUR_MIN = 60;             // duração do jogo
const HORIZONTE_DIAS = 14;      // até quantos dias à frente procura match
const ANTECEDENCIA_MIN = 120;   // jogo de hoje só se começar daqui a 2h+
const PRAZO_CONFIRMACAO_MIN = 120; // clube precisa confirmar até 2h antes do jogo
const ATIVOS = ['formado', 'pre_reservado', 'confirmado'];
const DIAS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
const DAY_KEY = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sab'];

// ── helpers de data/hora (horário de Brasília) ─────────────────────────────
const toMin = t => { const [h, m = 0] = String(t).slice(0, 5).split(':').map(Number); return h * 60 + m; };
const fromMin = m => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const ymd = d => (d instanceof Date ? d.toISOString() : String(d)).slice(0, 10);

function nowBR() {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date()).map(x => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, mins: (Number(p.hour) % 24) * 60 + Number(p.minute) };
}
function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const dow = dateStr => new Date(dateStr + 'T12:00:00Z').getUTCDay();
const fmtData = dateStr => { const [y, m, d] = dateStr.split('-'); return `${DIAS[dow(dateStr)]} ${d}/${m}`; };
const primeiroNome = n => String(n || '').trim().split(/\s+/)[0] || 'Aluno';

/** Telefone → chave comparável (DDD + 8 últimos dígitos), ignora 55 e o 9º dígito */
function phoneKey(raw) {
  let d = String(raw || '').replace(/\D/g, '');
  if (d.startsWith('55') && d.length >= 12) d = d.slice(2);
  if (d.length < 10) return null;
  return d.slice(0, 2) + d.slice(-8);
}

// ── disponibilidade de quadra ───────────────────────────────────────────────
function abertoNoHorario(hoursJson, dateStr, ini, fim) {
  const h = hoursJson && hoursJson[DAY_KEY[dow(dateStr)]];
  if (!h || !h.open) return false;
  return toMin(h.start) <= ini && toMin(h.end) >= fim;
}

/** Retorna a quadra livre mais barata da modalidade no horário, ou null */
async function quadraLivre(db, estId, modalidade, dateStr, ini, fim) {
  const { rows } = await db.query(
    `SELECT p.id, p.name, p.custom_hours, e.operating_hours,
            COALESCE(p.price_per_hour_aluno, p.price_per_hour) AS preco
       FROM points p JOIN establishments e ON e.id = p.est_id
      WHERE p.est_id = $1 AND p.type = $2
        AND NOT EXISTS (
          SELECT 1 FROM reservations r
           WHERE r.point_id = p.id AND r.date = $3 AND r.status <> 'cancelled'
             AND r.start_time < $5 AND r.end_time > $4)
      ORDER BY preco, p.id`,
    [estId, modalidade, dateStr, fromMin(ini), fromMin(fim)]
  );
  return rows.find(p => abertoNoHorario(p.custom_hours || p.operating_hours, dateStr, ini, fim)) || null;
}

// ── mensagens ───────────────────────────────────────────────────────────────
function resumoJogo(g, estName) {
  return `🏟️ ${estName} · ${g.modalidade} (${g.formato === 'dupla' ? 'dupla' : 'simples'})\n` +
         `📅 ${fmtData(ymd(g.data))}\n⏰ ${String(g.hora_inicio).slice(0, 5)}–${String(g.hora_fim).slice(0, 5)}`;
}

async function participantes(db, grupoId) {
  const { rows } = await db.query(
    `SELECT mp.intencao_id, mp.user_id, a.id AS aluno_id, a.nome, a.telefone
       FROM match_participantes mp JOIN alunos a ON a.id = mp.aluno_id
      WHERE mp.grupo_id = $1 ORDER BY a.nome`, [grupoId]);
  return rows;
}

async function avisarParticipantes(db, g, estName, montar) {
  const parts = await participantes(db, g.id);
  for (const p of parts) {
    if (!p.telefone) continue;
    const outros = parts.filter(x => x.aluno_id !== p.aluno_id).map(x => primeiroNome(x.nome));
    await enqueueTo(g.est_id, p.telefone, montar(p, outros));
  }
  return parts;
}

const msgMatch = (estName, g) => (p, outros) =>
  `🎾 *Match encontrado!*\n\nOlá, ${primeiroNome(p.nome)}! Achamos ${outros.length > 1 ? 'parceiros' : 'um parceiro'} para você jogar:\n` +
  `${resumoJogo(g, estName)}\n👥 Com: ${outros.join(', ')}\n\n` +
  `Para pedir a quadra ao clube, acesse:\n${SITE}/match\n\n_O clube confirma a reserva e o pagamento é feito no local._`;

// ── motor de match ──────────────────────────────────────────────────────────
/**
 * Procura e forma grupos. estId opcional (só um clube). Retorna grupos criados.
 * Trava por clube (advisory lock) para não formar grupo duplicado com 2 instâncias.
 */
async function runMatching(estId = null) {
  const { rows: ests } = await pool.query(
    `SELECT id, name FROM establishments
      WHERE COALESCE(features->>'match','false') = 'true' ${estId ? 'AND id = $1' : ''}`,
    estId ? [estId] : []);
  const criados = [];
  for (const est of ests) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows: [lk] } = await client.query('SELECT pg_try_advisory_xact_lock(91001, $1) AS ok', [est.id]);
      if (!lk.ok) { await client.query('ROLLBACK'); continue; }
      const novos = await matchEst(client, est);
      await client.query('COMMIT');
      // avisos só depois do COMMIT (se der rollback, ninguém recebe mensagem de grupo que não existe)
      for (const g of novos) await avisarParticipantes(pool, g, est.name, msgMatch(est.name, g)).catch(e => console.error('[match] aviso', e.message));
      criados.push(...novos);
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      console.error('[match] erro no clube', est.id, e.message);
    } finally {
      client.release();
    }
  }
  return criados;
}

async function matchEst(db, est) {
  const now = nowBR();
  const ultimo = addDays(now.date, HORIZONTE_DIAS - 1);
  const { rows: ints } = await db.query(
    `SELECT i.* FROM match_intencoes i
       JOIN alunos a ON a.id = i.aluno_id AND a.ativo IS NOT FALSE
      WHERE i.est_id = $1 AND i.status = 'aberta'
        AND (i.tipo = 'semanal' OR (i.data >= $2 AND i.data <= $3))
      ORDER BY i.created_at, i.id`, [est.id, now.date, ultimo]);
  if (!ints.length) return [];

  // quem já está num grupo ativo em cada data (aluno e intenção)
  const { rows: ocup } = await db.query(
    `SELECT mp.intencao_id, mp.aluno_id, g.data, g.status
       FROM match_participantes mp JOIN match_grupos g ON g.id = mp.grupo_id
      WHERE g.est_id = $1 AND g.status = ANY($2) AND g.data >= $3`,
    [est.id, [...ATIVOS, 'recusado'], now.date]);
  // intenção recusada pelo clube numa data não volta a formar grupo nessa mesma data
  const intOcup = new Set(ocup.map(o => `${o.intencao_id}|${ymd(o.data)}`));
  const alunoOcup = new Set(ocup.filter(o => ATIVOS.includes(o.status)).map(o => `${o.aluno_id}|${ymd(o.data)}`));

  const criados = [];
  for (let k = 0; k < HORIZONTE_DIAS; k++) {
    const data = addDays(now.date, k);
    const aplicaveis = ints.filter(i => {
      if (i.tipo === 'avulsa' && ymd(i.data) !== data) return false;
      if (i.tipo === 'semanal') {
        if (Number(i.dia_semana) !== dow(data)) return false;
        if (i.expira_em && new Date(i.expira_em) < new Date(data + 'T00:00:00-03:00')) return false;
      }
      return !intOcup.has(`${i.id}|${data}`) && !alunoOcup.has(`${i.aluno_id}|${data}`);
    });
    const porChave = {};
    for (const i of aplicaveis) {
      const key = `${i.modalidade}|${i.formato}|${i.nivel}`;
      (porChave[key] = porChave[key] || []).push(i);
    }

    for (const lista of Object.values(porChave)) {
      const n = TAM[lista[0].formato];
      const usados = new Set();
      for (let a = 0; a < lista.length; a++) {
        const base = lista[a];
        if (usados.has(base.id) || alunoOcup.has(`${base.aluno_id}|${data}`)) continue;
        let ini = toMin(base.hora_inicio), fim = toMin(base.hora_fim);
        if (data === now.date) ini = Math.max(ini, Math.ceil((now.mins + ANTECEDENCIA_MIN) / 30) * 30);
        if (fim - ini < DUR_MIN) continue;
        const grupo = [base];
        const alunos = new Set([base.aluno_id]);
        for (let b = a + 1; b < lista.length && grupo.length < n; b++) {
          const c = lista[b];
          if (usados.has(c.id) || alunos.has(c.aluno_id) || alunoOcup.has(`${c.aluno_id}|${data}`)) continue;
          const i2 = Math.max(ini, toMin(c.hora_inicio)), f2 = Math.min(fim, toMin(c.hora_fim));
          if (f2 - i2 < DUR_MIN) continue;
          grupo.push(c); alunos.add(c.aluno_id); ini = i2; fim = f2;
        }
        if (grupo.length < n) continue;

        // primeiro horário da janela comum com quadra livre
        let quadra = null, t = ini;
        for (; t + DUR_MIN <= fim; t += 30) {
          quadra = await quadraLivre(db, est.id, base.modalidade, data, t, t + DUR_MIN);
          if (quadra) break;
        }
        if (!quadra) continue;

        const { rows: [g] } = await db.query(
          `INSERT INTO match_grupos (est_id, modalidade, formato, nivel, data, hora_inicio, hora_fim)
           VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
          [est.id, base.modalidade, base.formato, base.nivel, data, fromMin(t), fromMin(t + DUR_MIN)]);
        for (const i of grupo) {
          await db.query(
            `INSERT INTO match_participantes (grupo_id, intencao_id, aluno_id, user_id) VALUES ($1,$2,$3,$4)`,
            [g.id, i.id, i.aluno_id, i.user_id]);
          if (i.tipo === 'avulsa') await db.query(`UPDATE match_intencoes SET status='em_match' WHERE id=$1`, [i.id]);
          usados.add(i.id); intOcup.add(`${i.id}|${data}`); alunoOcup.add(`${i.aluno_id}|${data}`);
        }
        criados.push(g);
      }
    }
  }
  return criados;
}

// ── pré-reserva, confirmação, recusa ────────────────────────────────────────
async function preReservar(grupoId, userId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: [g] } = await client.query(
      `SELECT g.*, e.name AS est_name FROM match_grupos g JOIN establishments e ON e.id = g.est_id
        WHERE g.id = $1 FOR UPDATE OF g`, [grupoId]);
    if (!g) throw httpErr(404, 'Match não encontrado');
    const parts = await participantes(client, g.id);
    const eu = parts.find(p => Number(p.user_id) === Number(userId));
    if (!eu) throw httpErr(403, 'Você não faz parte deste match');
    if (g.status === 'pre_reservado' || g.status === 'confirmado') throw httpErr(409, 'A quadra já foi pedida para este match');
    if (g.status !== 'formado') throw httpErr(409, 'Este match não está mais disponível');

    const data = ymd(g.data), ini = toMin(g.hora_inicio), fim = toMin(g.hora_fim);
    const quadra = await quadraLivre(client, g.est_id, g.modalidade, data, ini, fim);
    if (!quadra) throw httpErr(409, 'Não há mais quadra livre neste horário. Avise o clube ou registre outro horário.');

    const nomes = parts.map(p => p.nome).join(' / ');
    const { rows: [r] } = await client.query(
      `INSERT INTO reservations (point_id, est_id, user_id, date, start_time, end_time, hours, total,
                                 payment_method, status, client_name, client_phone, observacoes, match_grupo_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'dinheiro','aguardando',$9,$10,$11,$12) RETURNING id`,
      [quadra.id, g.est_id, userId, data, fromMin(ini), fromMin(fim), (fim - ini) / 60,
       Number(quadra.preco) * (fim - ini) / 60, nomes, eu.telefone || null,
       `Via Match #${g.id} (${g.formato}, ${NIVEL_LABEL[g.nivel] || g.nivel})`, g.id]);
    await client.query(
      `UPDATE match_grupos SET status='pre_reservado', reservation_id=$1, solicitado_por=$2, updated_at=NOW() WHERE id=$3`,
      [r.id, userId, g.id]);
    await client.query('COMMIT');

    // avisos (fora da transação)
    await enqueue(g.est_id,
      `🎾 *Pré-reserva via Match*\n👥 ${nomes}\n🏟️ ${quadra.name}\n📆 ${fmtData(data)}\n⏰ ${fromMin(ini)}–${fromMin(fim)}\n\n` +
      `⚠️ Aguardando confirmação no CRM (menu 🎾 Match).`);
    for (const p of parts) {
      if (!p.telefone) continue;
      await enqueueTo(g.est_id, p.telefone,
        `📨 *Pedido de quadra enviado!*\n\n${primeiroNome(eu.nome)} pediu a quadra para o seu match:\n` +
        `${resumoJogo(g, g.est_name)}\n🏟️ ${quadra.name}\n\nAssim que o clube confirmar, você recebe uma mensagem aqui.`);
    }
    return { reservation_id: r.id, quadra: quadra.name };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

async function confirmar(grupoId, crmUserId) {
  const { rows: [g] } = await pool.query(
    `SELECT g.*, e.name AS est_name, p.name AS quadra
       FROM match_grupos g JOIN establishments e ON e.id = g.est_id
       LEFT JOIN reservations r ON r.id = g.reservation_id
       LEFT JOIN points p ON p.id = r.point_id
      WHERE g.id = $1`, [grupoId]);
  if (!g) throw httpErr(404, 'Match não encontrado');
  if (g.status !== 'pre_reservado') throw httpErr(409, 'Este match não está aguardando confirmação');
  const { rowCount } = await pool.query(
    `UPDATE reservations SET status='confirmed', crm_user_id=COALESCE(crm_user_id,$2) WHERE id=$1 AND status='aguardando'`,
    [g.reservation_id, crmUserId || null]);
  if (!rowCount) throw httpErr(409, 'A reserva deste match não está mais aguardando');
  await pool.query(`UPDATE match_grupos SET status='confirmado', updated_at=NOW() WHERE id=$1`, [g.id]);
  await avisarParticipantes(pool, g, g.est_name, (p, outros) =>
    `✅ *Quadra confirmada!*\n\n${resumoJogo(g, g.est_name)}\n🏟️ ${g.quadra || 'Quadra'}\n👥 Com: ${outros.join(', ')}\n\n` +
    `Pagamento no clube. Bom jogo, ${primeiroNome(p.nome)}! 🎾`);
  return { ok: true };
}

/** Libera o grupo: cancela a pré-reserva, devolve intenções avulsas e avisa. */
async function encerrar(grupoId, novoStatus, motivoMsg) {
  const { rows: [g] } = await pool.query(
    `SELECT g.*, e.name AS est_name FROM match_grupos g JOIN establishments e ON e.id = g.est_id WHERE g.id = $1`, [grupoId]);
  if (!g) throw httpErr(404, 'Match não encontrado');
  if (!['formado', 'pre_reservado'].includes(g.status)) throw httpErr(409, 'Este match já foi encerrado');
  if (g.reservation_id)
    await pool.query(`UPDATE reservations SET status='cancelled' WHERE id=$1 AND status='aguardando'`, [g.reservation_id]);
  await pool.query(`UPDATE match_grupos SET status=$2, updated_at=NOW() WHERE id=$1`, [g.id, novoStatus]);
  // intenção avulsa volta a valer se o jogo ainda não passou; senão expira
  const now = nowBR();
  const aindaDa = novoStatus !== 'recusado' &&
    (ymd(g.data) > now.date || (ymd(g.data) === now.date && toMin(g.hora_inicio) > now.mins + ANTECEDENCIA_MIN));
  await pool.query(
    `UPDATE match_intencoes SET status=$2
      WHERE id IN (SELECT intencao_id FROM match_participantes WHERE grupo_id=$1)
        AND tipo='avulsa' AND status='em_match'`, [g.id, aindaDa ? 'aberta' : 'expirada']);
  if (motivoMsg) await avisarParticipantes(pool, g, g.est_name, (p) => motivoMsg(p, g));
  return g;
}

async function recusar(grupoId, motivo) {
  return encerrar(grupoId, 'recusado', (p, g) =>
    `❌ *O clube não conseguiu confirmar a quadra*\n\n${resumoJogo(g, g.est_name)}` +
    `${motivo ? `\n\nMotivo: ${motivo}` : ''}\n\nSe quiser, registre outro horário em ${SITE}/match — intenções semanais continuam valendo para as próximas semanas.`);
}

/** Expirações — roda no cron */
async function expirar() {
  const now = nowBR();
  // Sincroniza pré-reservas mexidas direto na tela de Reservas (confirmada ou cancelada lá)
  const { rows: sync } = await pool.query(
    `SELECT g.id, r.status AS r_status FROM match_grupos g JOIN reservations r ON r.id = g.reservation_id
      WHERE g.status = 'pre_reservado' AND r.status IN ('confirmed','cancelled')`);
  for (const g of sync) {
    if (g.r_status === 'confirmed') {
      await pool.query(`UPDATE reservations SET status='aguardando' WHERE id=(SELECT reservation_id FROM match_grupos WHERE id=$1)`, [g.id]);
      await confirmar(g.id, null).catch(e => console.error('[match] sync confirmar', e.message));
    } else {
      await recusar(g.id, 'reserva cancelada pelo clube').catch(e => console.error('[match] sync recusar', e.message));
    }
  }
  // grupos sem pedido de quadra cujo horário chegou
  const { rows: formados } = await pool.query(
    `SELECT id, data, hora_inicio FROM match_grupos WHERE status='formado' AND data <= $1`, [now.date]);
  for (const g of formados) {
    if (ymd(g.data) < now.date || toMin(g.hora_inicio) <= now.mins) await encerrar(g.id, 'expirado', null).catch(() => {});
  }
  // pré-reservas que o clube não confirmou até o prazo
  const { rows: pend } = await pool.query(
    `SELECT id, data, hora_inicio FROM match_grupos WHERE status='pre_reservado' AND data <= $1`, [now.date]);
  for (const g of pend) {
    if (ymd(g.data) < now.date || toMin(g.hora_inicio) - now.mins <= PRAZO_CONFIRMACAO_MIN) {
      await encerrar(g.id, 'expirado', (p, gg) =>
        `⌛ *A quadra do seu match não foi confirmada a tempo*\n\n${resumoJogo(gg, gg.est_name)}\n\n` +
        `A pré-reserva foi liberada. Registre um novo horário em ${SITE}/match`).catch(() => {});
    }
  }
  await pool.query(`UPDATE match_intencoes SET status='expirada' WHERE status='aberta' AND tipo='avulsa' AND data < $1`, [now.date]);
  await pool.query(`UPDATE match_intencoes SET status='expirada' WHERE status='aberta' AND tipo='semanal' AND expira_em < NOW()`);
}

function httpErr(status, message) { return Object.assign(new Error(message), { status }); }

module.exports = {
  TAM, NIVEIS, NIVEL_LABEL, DUR_MIN, HORIZONTE_DIAS,
  nowBR, addDays, toMin, fromMin, ymd, phoneKey, primeiroNome,
  runMatching, preReservar, confirmar, recusar, encerrar, expirar, participantes, httpErr,
};
