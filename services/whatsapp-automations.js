/**
 * WhatsApp Automations Service
 * Executa automações de mensagens por estabelecimento.
 */
const pool = require('../db/pool');
const wa   = require('./whatsapp');

const fmt$ = (v) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v || 0);

function fillTemplate(tpl, vars) {
  return tpl.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');
}

async function logResult(estId, type, status, name, phone, message, errMsg) {
  await pool.query(
    `INSERT INTO whatsapp_automation_logs
       (est_id, automation_type, status, recipient_name, recipient_phone, message, error_message)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [estId, type, status, name, phone, message, errMsg || null]
  ).catch(() => {});
}

async function updateLastRun(estId, type) {
  await pool.query(
    `UPDATE whatsapp_automations SET last_run=NOW(), updated_at=NOW() WHERE est_id=$1 AND type=$2`,
    [estId, type]
  ).catch(() => {});
}

// Saldo total pendente de um aluno
async function getSaldoPendente(alunoId, estId) {
  const { rows } = await pool.query(`
    SELECT COALESCE(SUM(v),0) AS total FROM (
      SELECT COALESCE(valor_total,0) AS v FROM planos_aula
        WHERE aluno_id=$1 AND est_id=$2 AND status_pgto='pendente'
      UNION ALL
      SELECT COALESCE(total,0) FROM bar_vendas
        WHERE aluno_id=$1 AND est_id=$2 AND status_pgto='pendente'
      UNION ALL
      SELECT COALESCE(total,0) FROM manutencao_vendas
        WHERE aluno_id=$1 AND est_id=$2 AND status_pgto='pendente'
    ) t
  `, [alunoId, estId]);
  return Number(rows[0]?.total || 0);
}

// ── I-a. Cobrança Mensal ─────────────────────────────────────────────────────
async function runCobrancaMensal(estId, config, estName) {
  const diaHoje = new Date().getDate();
  const diaCfg  = Number(config.dia_do_mes ?? 5);
  if (diaHoje !== diaCfg) return { skipped: true, reason: `dia ${diaHoje} ≠ ${diaCfg}` };

  const tpl = config.mensagem ||
    'Olá {nome}! 👋\n\nPassando para avisar que você tem um saldo pendente de *{valor}* no {estabelecimento}.\n\nPor favor, entre em contato para regularizar. 🙏';

  const { rows: alunos } = await pool.query(
    `SELECT id, nome, telefone FROM alunos
     WHERE est_id=$1 AND ativo=true AND telefone IS NOT NULL AND telefone != ''`,
    [estId]
  );

  let sent = 0, failed = 0;
  for (const a of alunos) {
    const saldo = await getSaldoPendente(a.id, estId);
    if (saldo <= 0) continue;
    const msg = fillTemplate(tpl, { nome: a.nome, valor: fmt$(saldo), estabelecimento: estName });
    try {
      await wa.sendText(a.telefone, msg);
      await logResult(estId, 'cobranca_mensal', 'success', a.nome, a.telefone, msg, null);
      sent++;
    } catch (err) {
      await logResult(estId, 'cobranca_mensal', 'failed', a.nome, a.telefone, msg, err.message);
      failed++;
    }
  }
  await updateLastRun(estId, 'cobranca_mensal');
  return { sent, failed };
}

// ── I-b. Saldo Pendente Antigo ───────────────────────────────────────────────
async function runSaldoPendente(estId, config, estName) {
  const dias  = Number(config.dias ?? 45);
  const freq  = config.frequencia || 'mensal'; // 'mensal' | 'quinzenal'
  const minDays = freq === 'quinzenal' ? 14 : 28;

  // Checar se já rodou recentemente
  const { rows: lr } = await pool.query(
    `SELECT last_run FROM whatsapp_automations WHERE est_id=$1 AND type='saldo_pendente'`,
    [estId]
  );
  if (lr[0]?.last_run) {
    const daysSince = (Date.now() - new Date(lr[0].last_run).getTime()) / 86_400_000;
    if (daysSince < minDays)
      return { skipped: true, reason: `${Math.round(daysSince)}d desde última execução (min ${minDays}d)` };
  }

  const tpl = config.mensagem ||
    'Olá {nome}! 👋\n\nNotamos que você tem um saldo em aberto de *{valor}* há mais de {dias} dias no {estabelecimento}.\n\nPodemos te ajudar a regularizar? Entre em contato! 💚';

  const { rows: alunos } = await pool.query(`
    SELECT DISTINCT a.id, a.nome, a.telefone FROM alunos a
    WHERE a.est_id=$1 AND a.ativo=true AND a.telefone IS NOT NULL AND a.telefone != ''
      AND (
        EXISTS (
          SELECT 1 FROM planos_aula p
          WHERE p.aluno_id=a.id AND p.est_id=$1 AND p.status_pgto='pendente'
            AND p.created_at < NOW() - ($2 || ' days')::INTERVAL
        )
        OR EXISTS (
          SELECT 1 FROM bar_vendas bv
          WHERE bv.aluno_id=a.id AND bv.est_id=$1 AND bv.status_pgto='pendente'
            AND bv.created_at < NOW() - ($2 || ' days')::INTERVAL
        )
      )
  `, [estId, dias]);

  let sent = 0, failed = 0;
  for (const a of alunos) {
    const saldo = await getSaldoPendente(a.id, estId);
    if (saldo <= 0) continue;
    const msg = fillTemplate(tpl, { nome: a.nome, valor: fmt$(saldo), dias: String(dias), estabelecimento: estName });
    try {
      await wa.sendText(a.telefone, msg);
      await logResult(estId, 'saldo_pendente', 'success', a.nome, a.telefone, msg, null);
      sent++;
    } catch (err) {
      await logResult(estId, 'saldo_pendente', 'failed', a.nome, a.telefone, msg, err.message);
      failed++;
    }
  }
  await updateLastRun(estId, 'saldo_pendente');
  return { sent, failed };
}

// ── II. Aniversário ──────────────────────────────────────────────────────────
async function runAniversario(estId, config, estName) {
  const tpl = config.mensagem ||
    '🎉 Feliz Aniversário, {nome}!\n\nToda a equipe do {estabelecimento} deseja um dia incrível! 🎂🎊\n\nVenha nos visitar e aproveite uma surpresa especial! 🎁';

  const hoje = new Date();
  const { rows: alunos } = await pool.query(`
    SELECT id, nome, telefone FROM alunos
    WHERE est_id=$1 AND ativo=true AND telefone IS NOT NULL AND telefone != ''
      AND data_nascimento IS NOT NULL
      AND EXTRACT(MONTH FROM data_nascimento) = $2
      AND EXTRACT(DAY   FROM data_nascimento) = $3
  `, [estId, hoje.getMonth() + 1, hoje.getDate()]);

  let sent = 0, failed = 0;
  for (const a of alunos) {
    const msg = fillTemplate(tpl, { nome: a.nome, estabelecimento: estName });
    try {
      await wa.sendText(a.telefone, msg);
      await logResult(estId, 'aniversario', 'success', a.nome, a.telefone, msg, null);
      sent++;
    } catch (err) {
      await logResult(estId, 'aniversario', 'failed', a.nome, a.telefone, msg, err.message);
      failed++;
    }
  }
  await updateLastRun(estId, 'aniversario');
  return { sent, failed };
}

// ── Runner principal — chamado pelo cron ─────────────────────────────────────
async function runAutomations() {
  try {
    const { rows } = await pool.query(`
      SELECT wa.*, e.name AS est_name
      FROM whatsapp_automations wa
      JOIN establishments e ON wa.est_id = e.id
      WHERE wa.enabled = true
    `);
    for (const auto of rows) {
      const { est_id, est_name, type, config } = auto;
      try {
        let result;
        if      (type === 'cobranca_mensal') result = await runCobrancaMensal(est_id, config || {}, est_name);
        else if (type === 'saldo_pendente')  result = await runSaldoPendente(est_id, config || {}, est_name);
        else if (type === 'aniversario')     result = await runAniversario(est_id, config || {}, est_name);
        console.log(`[WA-Auto] ${est_name}/${type}:`, JSON.stringify(result));
      } catch (err) {
        console.error(`[WA-Auto] Erro ${est_name}/${type}:`, err.message);
      }
    }
  } catch (err) {
    console.error('[WA-Auto] Erro geral:', err.message);
  }
}

module.exports = { runAutomations };
