const router = require('express').Router();
const pool   = require('../db/pool');
const { auth, adminOnly, adminOrManager } = require('../middleware/auth');
const { sendText, formatPhone, instanceForEst } = require('../services/whatsapp');

// simples também pode gerenciar alunos do seu est
function canManageAluno(user) {
  return ['admin','manager','simples','professor'].includes(user.role);
}

// ── GET / — lista alunos ──────────────────────────────────────────
router.get('/', auth, async (req, res) => {
  try {
    const params = [];
    const where  = [];

    if (req.user.role === 'manager') {
      const ids = Array.from(new Set([
        ...(req.user.est_ids || []),
        ...(req.user.est_id ? [req.user.est_id] : []),
      ])).map(Number).filter(Boolean);
      if (ids.length) {
        params.push(ids);
        where.push(`a.est_id = ANY($${params.length})`);
      }
    } else if (req.user.role === 'simples' && req.user.est_id) {
      params.push(req.user.est_id);
      where.push(`a.est_id = $${params.length}`);
    } else if (req.user.role === 'professor') {
      if (req.user.professor_id) {
        params.push(req.user.professor_id);
        where.push(`a.professor_id = $${params.length}`);
      } else if (req.user.est_id) {
        params.push(req.user.est_id);
        where.push(`a.est_id = $${params.length}`);
      }
    }

    // ativo filter
    if (req.query.ativo === 'true')  { params.push(true);  where.push(`a.ativo = $${params.length}`); }
    if (req.query.ativo === 'false') { params.push(false); where.push(`a.ativo = $${params.length}`); }

    const ws = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const { rows } = await pool.query(
      `SELECT a.*, e.name AS est_name
       FROM alunos a
       LEFT JOIN establishments e ON a.est_id = e.id
       ${ws}
       ORDER BY a.nome`,
      params
    );
    res.json(rows);
  } catch (err) {
    console.error('[GET /alunos]', err);
    res.status(500).json({ error: 'Erro ao listar alunos' });
  }
});

// ── POST /notificar-vencidos — envia WhatsApp para alunos com mensalidade vencida ─
router.post('/notificar-vencidos', auth, async (req, res) => {
  if (!canManageAluno(req.user)) return res.status(403).json({ error: 'Sem permissão' });
  try {
    const params = [];
    const where  = [`a.ativo = TRUE`, `a.mensalidade_vencimento IS NOT NULL`, `a.mensalidade_vencimento < CURRENT_DATE`, `a.telefone IS NOT NULL`];

    // scope por estabelecimento
    if (req.user.role === 'manager') {
      const ids = Array.from(new Set([...(req.user.est_ids || []), ...(req.user.est_id ? [req.user.est_id] : [])])).map(Number).filter(Boolean);
      if (ids.length) { params.push(ids); where.push(`a.est_id = ANY($${params.length})`); }
    } else if (req.user.role === 'simples' && req.user.est_id) {
      params.push(req.user.est_id); where.push(`a.est_id = $${params.length}`);
    } else if (req.user.role === 'professor' && req.user.professor_id) {
      params.push(req.user.professor_id); where.push(`a.professor_id = $${params.length}`);
    }

    // filtro de IDs específicos (aviso individual)
    const { alunoIds } = req.body;
    if (Array.isArray(alunoIds) && alunoIds.length) {
      params.push(alunoIds.map(Number));
      where.push(`a.id = ANY($${params.length})`);
    }

    const { rows: alunos } = await pool.query(
      `SELECT a.* FROM alunos a WHERE ${where.join(' AND ')} ORDER BY a.nome`,
      params
    );

    const results = [];
    for (const a of alunos) {
      const venc = new Date(a.mensalidade_vencimento);
      const hoje = new Date();
      const diasVenc = Math.floor((hoje - venc) / 86400000);
      const valor = a.mensalidade_valor ? `R$ ${Number(a.mensalidade_valor).toFixed(2).replace('.',',')}` : '';
      const msg = `Olá, ${a.nome.split(' ')[0]}! 👋\n\nSua mensalidade${valor ? ` de ${valor}` : ''} venceu há ${diasVenc} dia${diasVenc !== 1 ? 's' : ''}.\n\nPor favor, entre em contato para regularizar. Obrigado! 🏆`;
      try {
        await sendText(formatPhone(a.telefone), msg, instanceForEst(a.est_id));
        await pool.query(`UPDATE alunos SET mensalidade_aviso_em = NOW() WHERE id = $1`, [a.id]);
        results.push({ id: a.id, nome: a.nome, ok: true });
      } catch (e) {
        results.push({ id: a.id, nome: a.nome, ok: false, error: e.message });
      }
    }
    res.json({ sent: results.filter(r => r.ok).length, failed: results.filter(r => !r.ok).length, results });
  } catch (err) {
    console.error('[POST /alunos/notificar-vencidos]', err);
    res.status(500).json({ error: 'Erro ao notificar alunos' });
  }
});

// ── POST / — cria aluno ───────────────────────────────────────────
router.post('/', auth, async (req, res) => {
  if (!canManageAluno(req.user)) return res.status(403).json({ error: 'Sem permissão' });
  const { nome, cpf, email, telefone, data_nascimento, mensalidade_valor, mensalidade_vencimento } = req.body;
  let { est_id } = req.body;
  if (req.user.role === 'simples') est_id = req.user.est_id;
  if (req.user.role === 'professor') est_id = req.user.est_id;
  if (req.user.role === 'manager' && !est_id) {
    est_id = req.user.est_id || (req.user.est_ids && req.user.est_ids[0]) || null;
  }
  const professor_id = req.user.role === 'professor' ? (req.user.professor_id || null) : null;
  if (!nome) return res.status(400).json({ error: 'Nome é obrigatório' });

  try {
    const { rows } = await pool.query(
      `INSERT INTO alunos (nome, cpf, email, telefone, data_nascimento, est_id, professor_id, mensalidade_valor, mensalidade_vencimento)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [nome, cpf || null, email || null, telefone || null, data_nascimento || null, est_id || null, professor_id,
       mensalidade_valor ? parseFloat(mensalidade_valor) : null, mensalidade_vencimento || null]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('[POST /alunos]', err);
    res.status(500).json({ error: 'Erro ao criar aluno' });
  }
});

// ── PUT /:id — atualiza aluno ─────────────────────────────────────
router.put('/:id', auth, async (req, res) => {
  const { nome, cpf, email, telefone, data_nascimento, est_id, ativo, professor_id, mensalidade_valor, mensalidade_vencimento } = req.body;
  try {
    const { rows } = await pool.query(
      `UPDATE alunos SET
         nome                   = COALESCE($1, nome),
         cpf                    = COALESCE($2, cpf),
         email                  = COALESCE($3, email),
         telefone               = COALESCE($4, telefone),
         data_nascimento        = COALESCE($5, data_nascimento),
         est_id                 = COALESCE($6, est_id),
         ativo                  = COALESCE($7, ativo),
         professor_id           = $8,
         mensalidade_valor      = $9,
         mensalidade_vencimento = $10,
         updated_at             = NOW()
       WHERE id = $11
       RETURNING *`,
      [nome || null, cpf || null, email || null, telefone || null,
       data_nascimento || null, est_id || null,
       ativo !== undefined ? ativo : null, professor_id || null,
       mensalidade_valor != null && mensalidade_valor !== '' ? parseFloat(mensalidade_valor) : null,
       mensalidade_vencimento || null,
       req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Aluno não encontrado' });
    res.json(rows[0]);
  } catch (err) {
    console.error('[PUT /alunos/:id]', err);
    res.status(500).json({ error: 'Erro ao atualizar aluno' });
  }
});

// ── DELETE /:id ───────────────────────────────────────────────────
router.delete('/:id', auth, async (req, res) => {
  if (!canManageAluno(req.user)) return res.status(403).json({ error: 'Sem permissão' });
  try {
    const { rowCount } = await pool.query('DELETE FROM alunos WHERE id = $1', [req.params.id]);
    if (!rowCount) return res.status(404).json({ error: 'Aluno não encontrado' });
    res.json({ message: 'Aluno removido' });
  } catch (err) {
    console.error('[DELETE /alunos/:id]', err);
    res.status(500).json({ error: 'Erro ao remover aluno' });
  }
});

module.exports = router;
