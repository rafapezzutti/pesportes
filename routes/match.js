/**
 * Rotas do Match — /api/match
 *   Público (aluno logado no site): vínculo com o clube, intenções, matches, pedir quadra
 *   CRM (clube): painel, confirmar / recusar pré-reserva
 */
const router = require('express').Router();
const crypto = require('crypto');
const pool   = require('../db/pool');
const { auth, crmOnly } = require('../middleware/auth');
const { sendText, instanceForEst } = require('../services/whatsapp');
const M = require('../services/match');

const MAX_INTENCOES = 10;

function publicOnly(req, res, next) {
  if (req.user?.type !== 'public') return res.status(403).json({ error: 'Entre com sua conta do site para usar o Match' });
  next();
}
const send = (res, e, ctx) => {
  if (!e.status) console.error(`[match] ${ctx}`, e);
  res.status(e.status || 500).json({ error: e.status ? e.message : 'Erro no Match' });
};
const hash = c => crypto.createHash('sha256').update(String(c)).digest('hex');

async function estMatch(estId) {
  const { rows } = await pool.query(
    `SELECT id, name FROM establishments WHERE id=$1 AND COALESCE(features->>'match','false')='true'`, [estId]);
  return rows[0] || null;
}

// ════════════════════════════ PÚBLICO ════════════════════════════

// Clubes com Match ligado + modalidades (tipos de quadra)
router.get('/estabelecimentos', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT e.id, e.name, e.city,
              COALESCE(array_agg(DISTINCT p.type) FILTER (WHERE p.type IS NOT NULL), '{}') AS modalidades
         FROM establishments e LEFT JOIN points p ON p.est_id = e.id
        WHERE COALESCE(e.features->>'match','false')='true'
        GROUP BY e.id ORDER BY e.name`);
    res.json(rows);
  } catch (e) { send(res, e, 'GET /estabelecimentos'); }
});

// Tudo do aluno logado: vínculos, intenções, matches
router.get('/me', auth, publicOnly, async (req, res) => {
  try {
    const uid = req.user.id;
    const [vinc, ints, grupos] = await Promise.all([
      pool.query(
        `SELECT v.est_id, e.name AS est_name, a.nome AS aluno_nome
           FROM match_vinculos v JOIN establishments e ON e.id=v.est_id JOIN alunos a ON a.id=v.aluno_id
          WHERE v.user_id=$1 AND v.verificado_em IS NOT NULL AND a.ativo IS NOT FALSE
          ORDER BY e.name`, [uid]),
      pool.query(
        `SELECT i.*, e.name AS est_name FROM match_intencoes i JOIN establishments e ON e.id=i.est_id
          WHERE i.user_id=$1 AND i.status IN ('aberta','em_match')
          ORDER BY i.created_at DESC`, [uid]),
      pool.query(
        `SELECT g.*, e.name AS est_name, p.name AS quadra,
                (SELECT json_agg(json_build_object('nome', split_part(a.nome,' ',1), 'eu', mp2.user_id=$1) ORDER BY a.nome)
                   FROM match_participantes mp2 JOIN alunos a ON a.id=mp2.aluno_id WHERE mp2.grupo_id=g.id) AS jogadores
           FROM match_grupos g
           JOIN match_participantes mp ON mp.grupo_id=g.id AND mp.user_id=$1
           JOIN establishments e ON e.id=g.est_id
           LEFT JOIN reservations r ON r.id=g.reservation_id
           LEFT JOIN points p ON p.id=r.point_id
          WHERE g.data >= (CURRENT_DATE - INTERVAL '7 days')
          ORDER BY g.data, g.hora_inicio`, [uid]),
    ]);
    res.json({ vinculos: vinc.rows, intencoes: ints.rows, grupos: grupos.rows, niveis: M.NIVEIS });
  } catch (e) { send(res, e, 'GET /me'); }
});

// Passo 1 do vínculo: telefone cadastrado no clube → código pelo WhatsApp do clube
router.post('/vinculo/solicitar', auth, publicOnly, async (req, res) => {
  const { est_id, telefone } = req.body;
  try {
    const est = await estMatch(est_id);
    if (!est) return res.status(400).json({ error: 'Este clube não participa do Match' });
    const key = M.phoneKey(telefone);
    if (!key) return res.status(400).json({ error: 'Informe o telefone com DDD' });

    const { rows: alunos } = await pool.query(
      `SELECT id, nome, telefone FROM alunos WHERE est_id=$1 AND ativo IS NOT FALSE AND telefone IS NOT NULL AND telefone <> ''`,
      [est.id]);
    const aluno = alunos.find(a => M.phoneKey(a.telefone) === key);
    // Resposta igual com ou sem aluno: não revela quem é aluno do clube
    const okMsg = { ok: true, message: 'Se este telefone estiver cadastrado como aluno, você vai receber um código no WhatsApp.' };
    if (!aluno) return res.json(okMsg);

    const { rows: [prev] } = await pool.query(
      `SELECT codigo_enviado_em FROM match_vinculos WHERE user_id=$1 AND est_id=$2`, [req.user.id, est.id]);
    if (prev?.codigo_enviado_em && Date.now() - new Date(prev.codigo_enviado_em).getTime() < 60_000)
      return res.status(429).json({ error: 'Aguarde 1 minuto para pedir outro código' });

    const codigo = String(crypto.randomInt(100000, 1000000));
    await pool.query(
      `INSERT INTO match_vinculos (user_id, est_id, aluno_id, codigo_hash, codigo_expira, codigo_enviado_em, tentativas)
       VALUES ($1,$2,$3,$4,NOW()+INTERVAL '10 minutes',NOW(),0)
       ON CONFLICT (user_id, est_id) DO UPDATE
         SET aluno_id=$3, codigo_hash=$4, codigo_expira=NOW()+INTERVAL '10 minutes', codigo_enviado_em=NOW(), tentativas=0`,
      [req.user.id, est.id, aluno.id, hash(codigo)]);
    await sendText(aluno.telefone,
      `🎾 Seu código para ativar o Match no *${est.name}*: *${codigo}*\n\nVale por 10 minutos. Se não foi você, ignore esta mensagem.`,
      instanceForEst(est.id)).catch(e => console.error('[match] envio do código', e.message));
    res.json(okMsg);
  } catch (e) { send(res, e, 'POST /vinculo/solicitar'); }
});

// Passo 2: confirma o código + consentimento
router.post('/vinculo/confirmar', auth, publicOnly, async (req, res) => {
  const { est_id, codigo, consentimento } = req.body;
  if (!consentimento) return res.status(400).json({ error: 'É preciso aceitar os termos do Match' });
  try {
    const { rows: [v] } = await pool.query(
      `SELECT * FROM match_vinculos WHERE user_id=$1 AND est_id=$2`, [req.user.id, est_id]);
    if (!v || !v.codigo_hash || new Date(v.codigo_expira) < new Date())
      return res.status(400).json({ error: 'Código expirado. Peça um novo.' });
    if (v.tentativas >= 5) return res.status(429).json({ error: 'Muitas tentativas. Peça um novo código.' });
    if (hash(String(codigo || '').trim()) !== v.codigo_hash) {
      await pool.query(`UPDATE match_vinculos SET tentativas=tentativas+1 WHERE id=$1`, [v.id]);
      return res.status(400).json({ error: 'Código incorreto' });
    }
    await pool.query(
      `UPDATE match_vinculos SET verificado_em=NOW(), consentimento_em=NOW(), codigo_hash=NULL WHERE id=$1`, [v.id]);
    res.json({ ok: true });
  } catch (e) { send(res, e, 'POST /vinculo/confirmar'); }
});

// Nova intenção
router.post('/intencoes', auth, publicOnly, async (req, res) => {
  const { est_id, modalidade, formato, nivel, tipo, data, dia_semana, hora_inicio, hora_fim } = req.body;
  try {
    const { rows: [v] } = await pool.query(
      `SELECT v.aluno_id FROM match_vinculos v JOIN alunos a ON a.id=v.aluno_id AND a.ativo IS NOT FALSE
        WHERE v.user_id=$1 AND v.est_id=$2 AND v.verificado_em IS NOT NULL`, [req.user.id, est_id]);
    if (!v) return res.status(403).json({ error: 'Vincule-se como aluno deste clube primeiro' });
    if (!(await estMatch(est_id))) return res.status(400).json({ error: 'Este clube não participa do Match' });

    const { rows: mods } = await pool.query(`SELECT 1 FROM points WHERE est_id=$1 AND type=$2 LIMIT 1`, [est_id, modalidade]);
    if (!mods.length) return res.status(400).json({ error: 'Modalidade inválida' });
    if (!M.TAM[formato]) return res.status(400).json({ error: 'Formato inválido' });
    if (!M.NIVEIS.includes(nivel)) return res.status(400).json({ error: 'Nível inválido' });
    if (!/^\d{2}:\d{2}$/.test(hora_inicio || '') || !/^\d{2}:\d{2}$/.test(hora_fim || ''))
      return res.status(400).json({ error: 'Horário inválido' });
    if (M.toMin(hora_fim) - M.toMin(hora_inicio) < M.DUR_MIN)
      return res.status(400).json({ error: 'A faixa de horário precisa ter pelo menos 1 hora' });

    const now = M.nowBR();
    let dataOk = null, dow = null, expira = null;
    if (tipo === 'avulsa') {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(data || '') || data < now.date || data > M.addDays(now.date, 60))
        return res.status(400).json({ error: 'Escolha uma data entre hoje e os próximos 60 dias' });
      dataOk = data;
    } else if (tipo === 'semanal') {
      dow = Number(dia_semana);
      if (!(dow >= 0 && dow <= 6)) return res.status(400).json({ error: 'Dia da semana inválido' });
      expira = new Date(Date.now() + 30 * 86400_000);
    } else return res.status(400).json({ error: 'Tipo inválido' });

    const { rows: [{ n }] } = await pool.query(
      `SELECT COUNT(*)::int AS n FROM match_intencoes WHERE user_id=$1 AND status IN ('aberta','em_match')`, [req.user.id]);
    if (n >= MAX_INTENCOES) return res.status(400).json({ error: `Você pode ter no máximo ${MAX_INTENCOES} intenções ativas` });

    const { rows: [i] } = await pool.query(
      `INSERT INTO match_intencoes (est_id, aluno_id, user_id, modalidade, formato, nivel, tipo, data, dia_semana, hora_inicio, hora_fim, expira_em)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [est_id, v.aluno_id, req.user.id, modalidade, formato, nivel, tipo, dataOk, dow, hora_inicio, hora_fim, expira]);

    await M.runMatching(Number(est_id));
    const { rows: part } = await pool.query(`SELECT 1 FROM match_participantes WHERE intencao_id=$1`, [i.id]);
    res.status(201).json({ intencao: i, match: part.length > 0 });
  } catch (e) { send(res, e, 'POST /intencoes'); }
});

// Cancelar intenção (se estiver num match ainda não confirmado, o match é desfeito e os outros avisados)
router.delete('/intencoes/:id', auth, publicOnly, async (req, res) => {
  try {
    const { rows: [i] } = await pool.query(
      `SELECT * FROM match_intencoes WHERE id=$1 AND user_id=$2`, [req.params.id, req.user.id]);
    if (!i) return res.status(404).json({ error: 'Intenção não encontrada' });
    const { rows: grupos } = await pool.query(
      `SELECT g.id, g.status FROM match_grupos g JOIN match_participantes mp ON mp.grupo_id=g.id
        WHERE mp.intencao_id=$1 AND g.status IN ('formado','pre_reservado')`, [i.id]);
    await pool.query(`UPDATE match_intencoes SET status='cancelada' WHERE id=$1`, [i.id]);
    for (const g of grupos) {
      await M.encerrar(g.id, 'cancelado', (p, gg) =>
        `ℹ️ *Um participante desistiu do match*\n\n${gg.modalidade} · ${M.ymd(gg.data).split('-').reverse().join('/')} · ${String(gg.hora_inicio).slice(0,5)}\n\n` +
        `Sua intenção continua ativa — avisamos quando surgir outro parceiro.`);
    }
    // quem sobrou pode formar match com outra pessoa
    if (grupos.length) M.runMatching(Number(i.est_id)).catch(() => {});
    res.json({ ok: true });
  } catch (e) { send(res, e, 'DELETE /intencoes/:id'); }
});

// Renovar intenção semanal por mais 30 dias
router.post('/intencoes/:id/renovar', auth, publicOnly, async (req, res) => {
  try {
    const { rowCount } = await pool.query(
      `UPDATE match_intencoes SET expira_em=NOW()+INTERVAL '30 days', status='aberta'
        WHERE id=$1 AND user_id=$2 AND tipo='semanal' AND status IN ('aberta','expirada')`,
      [req.params.id, req.user.id]);
    if (!rowCount) return res.status(404).json({ error: 'Intenção não encontrada' });
    res.json({ ok: true });
  } catch (e) { send(res, e, 'POST /intencoes/:id/renovar'); }
});

// Pedir a quadra (pré-reserva aguardando confirmação do clube)
router.post('/grupos/:id/reservar', auth, publicOnly, async (req, res) => {
  try { res.json(await M.preReservar(Number(req.params.id), req.user.id)); }
  catch (e) { send(res, e, 'POST /grupos/:id/reservar'); }
});

// ════════════════════════════ CRM ════════════════════════════
const CRM_ROLES = ['admin', 'manager', 'simples', 'recepcao'];
function estIdsDo(user) {
  return Array.from(new Set([...(user.est_ids || []), ...(user.est_id ? [user.est_id] : [])])).map(Number).filter(Boolean);
}
function crmMatch(req, res, next) {
  if (!CRM_ROLES.includes(req.user.role)) return res.status(403).json({ error: 'Sem permissão' });
  next();
}
async function grupoDoClube(req, res) {
  const { rows: [g] } = await pool.query(`SELECT * FROM match_grupos WHERE id=$1`, [req.params.id]);
  if (!g) { res.status(404).json({ error: 'Match não encontrado' }); return null; }
  if (req.user.role !== 'admin' && !estIdsDo(req.user).includes(Number(g.est_id))) {
    res.status(403).json({ error: 'Match de outro estabelecimento' }); return null;
  }
  return g;
}

// Painel: clubes do usuário, pendências, matches recentes, intenções abertas, números do mês
router.get('/crm/painel', auth, crmOnly, crmMatch, async (req, res) => {
  try {
    const ids = req.user.role === 'admin' ? null : estIdsDo(req.user);
    const scope = (alias, n) => (ids ? `${alias}.est_id = ANY($${n})` : 'TRUE');
    const p = ids ? [ids] : [];
    const [ests, grupos, ints, stats] = await Promise.all([
      pool.query(
        `SELECT id, name, COALESCE(features->>'match','false')='true' AS match_enabled
           FROM establishments e WHERE ${scope('e', 1).replace('e.est_id', 'e.id')} ORDER BY name`, p),
      pool.query(
        `SELECT g.*, e.name AS est_name, pt.name AS quadra, r.total,
                (SELECT json_agg(json_build_object('nome', a.nome, 'telefone', a.telefone) ORDER BY a.nome)
                   FROM match_participantes mp JOIN alunos a ON a.id=mp.aluno_id WHERE mp.grupo_id=g.id) AS jogadores
           FROM match_grupos g JOIN establishments e ON e.id=g.est_id
           LEFT JOIN reservations r ON r.id=g.reservation_id
           LEFT JOIN points pt ON pt.id=r.point_id
          WHERE ${scope('g', 1)} AND (g.status IN ('formado','pre_reservado') OR g.created_at > NOW() - INTERVAL '30 days')
          ORDER BY CASE g.status WHEN 'pre_reservado' THEN 0 WHEN 'formado' THEN 1 ELSE 2 END, g.data, g.hora_inicio
          LIMIT 200`, p),
      pool.query(
        `SELECT i.id, i.est_id, i.modalidade, i.formato, i.nivel, i.tipo, i.data, i.dia_semana,
                i.hora_inicio, i.hora_fim, i.status, i.created_at, a.nome AS aluno_nome
           FROM match_intencoes i JOIN alunos a ON a.id=i.aluno_id
          WHERE ${scope('i', 1)} AND i.status IN ('aberta','em_match')
          ORDER BY i.modalidade, i.nivel, i.created_at`, p),
      pool.query(
        `SELECT COUNT(*) FILTER (WHERE g.created_at >= date_trunc('month', NOW()))::int AS matches_mes,
                COUNT(*) FILTER (WHERE g.status='confirmado' AND g.data >= date_trunc('month', NOW())::date)::int AS reservas_mes,
                COALESCE(SUM(r.total) FILTER (WHERE g.status='confirmado' AND g.data >= date_trunc('month', NOW())::date),0) AS receita_mes
           FROM match_grupos g LEFT JOIN reservations r ON r.id=g.reservation_id
          WHERE ${scope('g', 1)}`, p),
    ]);
    res.json({ estabelecimentos: ests.rows, grupos: grupos.rows, intencoes: ints.rows, stats: stats.rows[0] });
  } catch (e) { send(res, e, 'GET /crm/painel'); }
});

router.post('/crm/grupos/:id/confirmar', auth, crmOnly, crmMatch, async (req, res) => {
  try {
    const g = await grupoDoClube(req, res); if (!g) return;
    res.json(await M.confirmar(g.id, req.user.id));
  } catch (e) { send(res, e, 'POST /crm/grupos/:id/confirmar'); }
});

router.post('/crm/grupos/:id/recusar', auth, crmOnly, crmMatch, async (req, res) => {
  try {
    const g = await grupoDoClube(req, res); if (!g) return;
    await M.recusar(g.id, String(req.body?.motivo || '').slice(0, 200));
    res.json({ ok: true });
  } catch (e) { send(res, e, 'POST /crm/grupos/:id/recusar'); }
});

module.exports = router;
