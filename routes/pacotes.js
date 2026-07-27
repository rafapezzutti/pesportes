const router = require('express').Router();
const pool   = require('../db/pool');
const { auth, adminOrManager } = require('../middleware/auth');
const { sendText, formatPhone, instanceForEst } = require('../services/whatsapp');

function canView(user) {
  return ['admin','manager','simples','professor'].includes(user.role);
}

function scopeWhere(req, params, alias = 'pk') {
  const clauses = [];
  if (req.user.role === 'manager') {
    const ids = Array.from(new Set([
      ...(req.user.est_ids || []),
      ...(req.user.est_id ? [req.user.est_id] : []),
    ])).map(Number).filter(Boolean);
    if (ids.length) { params.push(ids); clauses.push(`${alias}.est_id = ANY($${params.length})`); }
  } else if (['simples', 'professor'].includes(req.user.role) && req.user.est_id) {
    params.push(req.user.est_id);
    clauses.push(`${alias}.est_id = $${params.length}`);
  }
  return clauses;
}

// GET /api/pacotes?estId=&alunoId=&ativo=
router.get('/', auth, async (req, res) => {
  if (!canView(req.user)) return res.status(403).json({ error: 'Sem permissão' });
  const { estId, alunoId, ativo } = req.query;
  const params = [];
  const where = scopeWhere(req, params);

  if (estId)   { params.push(estId);   where.push(`pk.est_id = $${params.length}`); }
  if (alunoId) { params.push(alunoId); where.push(`pk.aluno_id = $${params.length}`); }
  if (ativo !== undefined && ativo !== '') {
    params.push(ativo === 'true' || ativo === '1');
    where.push(`pk.ativo = $${params.length}`);
  }

  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';

  try {
    const { rows } = await pool.query(
      `SELECT pk.*,
              a.nome        AS aluno_nome,
              a.telefone    AS aluno_telefone,
              e.name        AS est_nome,
              COALESCE(cons.consumido, 0)   AS consumido,
              cons.ultima_data
       FROM pacotes pk
       LEFT JOIN alunos a         ON a.id  = pk.aluno_id
       LEFT JOIN establishments e ON e.id  = pk.est_id
       LEFT JOIN (
         SELECT pacote_id,
                COUNT(*)   AS consumido,
                MAX(data)  AS ultima_data
         FROM aulas_avulsas
         WHERE pacote_id IS NOT NULL
         GROUP BY pacote_id
       ) cons ON cons.pacote_id = pk.id
       ${whereSql}
       ORDER BY pk.ativo DESC, pk.data_compra DESC`,
      params
    );
    res.json(rows);
  } catch (err) {
    console.error('[GET /pacotes]', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/pacotes/:id
router.get('/:id', auth, async (req, res) => {
  if (!canView(req.user)) return res.status(403).json({ error: 'Sem permissão' });
  try {
    const { rows } = await pool.query(
      `SELECT pk.*,
              a.nome     AS aluno_nome,
              a.telefone AS aluno_telefone,
              e.name     AS est_nome,
              COALESCE(cons.consumido, 0) AS consumido,
              cons.ultima_data
       FROM pacotes pk
       LEFT JOIN alunos a         ON a.id = pk.aluno_id
       LEFT JOIN establishments e ON e.id = pk.est_id
       LEFT JOIN (
         SELECT pacote_id, COUNT(*) AS consumido, MAX(data) AS ultima_data
         FROM aulas_avulsas WHERE pacote_id IS NOT NULL GROUP BY pacote_id
       ) cons ON cons.pacote_id = pk.id
       WHERE pk.id = $1`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Pacote não encontrado' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/pacotes
router.post('/', auth, async (req, res) => {
  if (!canView(req.user)) return res.status(403).json({ error: 'Sem permissão' });
  const { aluno_id, nome, tipo, quantidade, valor, data_compra, data_validade, obs } = req.body;

  let est_id = req.body.est_id;
  if (['simples', 'professor'].includes(req.user.role)) {
    est_id = req.user.est_id;
  } else if (req.user.role === 'manager') {
    est_id = req.body.est_id || req.user.est_id || req.user.est_ids?.[0] || null;
  }

  if (!nome)     return res.status(400).json({ error: 'Nome do pacote é obrigatório' });
  if (!aluno_id) return res.status(400).json({ error: 'Aluno é obrigatório' });
  if (!est_id)   return res.status(400).json({ error: 'Estabelecimento é obrigatório' });
  if (!quantidade || Number(quantidade) <= 0) return res.status(400).json({ error: 'Quantidade inválida' });

  try {
    const { rows } = await pool.query(
      `INSERT INTO pacotes (est_id, aluno_id, nome, tipo, quantidade, valor, data_compra, data_validade, obs)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [est_id, aluno_id, nome, tipo || 'aulas', Number(quantidade),
       valor ? Number(valor) : 0,
       data_compra || new Date().toISOString().split('T')[0],
       data_validade || null, obs || null]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('[POST /pacotes]', err);
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/pacotes/:id
router.put('/:id', auth, async (req, res) => {
  if (!canView(req.user)) return res.status(403).json({ error: 'Sem permissão' });
  const { aluno_id, nome, tipo, quantidade, valor, data_compra, data_validade, obs, ativo } = req.body;
  try {
    const { rows } = await pool.query(
      `UPDATE pacotes SET
         aluno_id=$1, nome=$2, tipo=$3, quantidade=$4, valor=$5,
         data_compra=$6, data_validade=$7, obs=$8, ativo=$9
       WHERE id=$10 RETURNING *`,
      [aluno_id, nome, tipo || 'aulas', Number(quantidade),
       valor ? Number(valor) : 0,
       data_compra, data_validade || null, obs || null,
       ativo !== false, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Pacote não encontrado' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/pacotes/:id
router.delete('/:id', auth, adminOrManager, async (req, res) => {
  try {
    await pool.query('DELETE FROM pacotes WHERE id=$1', [req.params.id]);
    res.json({ message: 'Pacote excluído' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/pacotes/:id/notificar — envia status do pacote via WhatsApp
router.post('/:id/notificar', auth, async (req, res) => {
  if (!canView(req.user)) return res.status(403).json({ error: 'Sem permissão' });
  try {
    const { rows } = await pool.query(
      `SELECT pk.*,
              a.nome AS aluno_nome, a.telefone AS aluno_telefone, e.name AS est_nome,
              COALESCE(cons.consumido, 0) AS consumido, cons.ultima_data
       FROM pacotes pk
       LEFT JOIN alunos a ON a.id = pk.aluno_id
       LEFT JOIN establishments e ON e.id = pk.est_id
       LEFT JOIN (
         SELECT pacote_id, COUNT(*) AS consumido, MAX(data) AS ultima_data
         FROM aulas_avulsas WHERE pacote_id IS NOT NULL GROUP BY pacote_id
       ) cons ON cons.pacote_id = pk.id
       WHERE pk.id = $1`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Pacote não encontrado' });
    const pk = rows[0];

    if (!pk.aluno_telefone)
      return res.status(400).json({ error: 'Aluno não possui telefone cadastrado' });

    const consumido  = Number(pk.consumido);
    const total      = Number(pk.quantidade);
    const restante   = Math.max(0, total - consumido);
    const pct        = total > 0 ? Math.round((consumido / total) * 100) : 0;
    const unidade    = pk.tipo === 'horas' ? 'hora' : 'aula';
    const unidades   = pk.tipo === 'horas' ? 'horas' : 'aulas';
    const nome1      = (pk.aluno_nome || '').split(' ')[0];
    const barra      = buildBar(pct);

    let msg;
    if (pct >= 100) {
      msg =
        `Olá, ${nome1}! 👋\n\n` +
        `Seu pacote *${pk.nome}* foi totalmente utilizado! 🎾\n\n` +
        `📊 Uso: ${consumido}/${total} ${unidades} (${pct}%)\n` +
        `${barra}\n\n` +
        `Gostaria de renovar? Entre em contato com a gente e continue aproveitando! 🏆`;
    } else {
      const ultima = pk.ultima_data
        ? new Date(pk.ultima_data).toLocaleDateString('pt-BR', { timeZone: 'UTC' })
        : null;
      msg =
        `Olá, ${nome1}! 👋\n\n` +
        `Atualização do seu pacote *${pk.nome}*:\n\n` +
        `✅ Utilizadas: ${consumido} ${consumido === 1 ? unidade : unidades}\n` +
        `🔄 Restantes: ${restante} ${restante === 1 ? unidade : unidades}\n` +
        `📊 ${pct}% consumido\n` +
        `${barra}\n` +
        (ultima ? `📅 Última atividade: ${ultima}\n` : '') +
        `\nQualquer dúvida estamos à disposição! 🏆`;
    }

    const instance = instanceForEst(pk.est_id);
    await sendText(formatPhone(pk.aluno_telefone), msg, instance);
    res.json({ message: 'Notificação enviada', pacote: pk.nome, aluno: pk.aluno_nome });
  } catch (err) {
    console.error('[POST /pacotes/:id/notificar]', err);
    res.status(500).json({ error: err.message });
  }
});

function buildBar(pct) {
  const filled = Math.round(pct / 10);
  return '▓'.repeat(filled) + '░'.repeat(10 - filled) + ` ${pct}%`;
}

module.exports = router;
