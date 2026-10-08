const router = require('express').Router();
const pool   = require('../db/pool');
const { auth, adminOnly, adminOrManager } = require('../middleware/auth');
const { sendText, formatPhone, instanceForEst } = require('../services/whatsapp');
const { requirePerm, userEstIds } = require('../middleware/permissions');

// Perfis que podem mexer em alunos; o que cada um pode fazer é decidido por requirePerm()
function canManageAluno(user) {
  return user.type === 'crm' && ['admin','manager','simples','professor','recepcao'].includes(user.role);
}

/**
 * O aluno está dentro do escopo do usuário?
 * admin: todos · manager: seus estabelecimentos · simples/recepcao: seu estabelecimento
 * professor: só os próprios alunos (ou o estabelecimento, se não tiver professor_id)
 */
function alunoInScope(user, aluno) {
  if (user.role === 'admin') return true;
  if (user.role === 'professor') {
    if (user.professor_id) return Number(aluno.professor_id) === Number(user.professor_id);
    return Number(aluno.est_id) === Number(user.est_id);
  }
  if (user.role === 'manager') return userEstIds(user).includes(Number(aluno.est_id));
  return !!user.est_id && Number(aluno.est_id) === Number(user.est_id);
}

async function loadAlunoInScope(req, res) {
  const { rows } = await pool.query('SELECT * FROM alunos WHERE id = $1', [req.params.id]);
  if (!rows.length) { res.status(404).json({ error: 'Aluno não encontrado' }); return null; }
  if (!alunoInScope(req.user, rows[0])) { res.status(403).json({ error: 'Aluno fora do seu escopo' }); return null; }
  return rows[0];
}

// ── GET / — lista alunos ──────────────────────────────────────────
router.get('/', auth, async (req, res) => {
  // Antes qualquer token (inclusive de cliente do site) listava todos os alunos
  if (!canManageAluno(req.user)) return res.status(403).json({ error: 'Sem permissão' });
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
    } else if (['simples','recepcao'].includes(req.user.role) && req.user.est_id) {
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

// ── POST /notificar-vencidos — envia WhatsApp para alunos ─────────────────────
// force=true: envia para qualquer aluno selecionado (não só vencidos)
router.post('/notificar-vencidos', auth, requirePerm('alunos_cobrar'), async (req, res) => {
  if (!canManageAluno(req.user)) return res.status(403).json({ error: 'Sem permissão' });
  try {
    const { alunoIds, force } = req.body;
    const params = [];
    const where  = [`a.ativo = TRUE`, `a.telefone IS NOT NULL`];

    // se não for force, exige mensalidade vencida
    if (!force) {
      where.push(`a.mensalidade_vencimento IS NOT NULL`);
      where.push(`a.mensalidade_vencimento < CURRENT_DATE`);
    }

    // scope por estabelecimento
    if (req.user.role === 'manager') {
      const ids = Array.from(new Set([...(req.user.est_ids || []), ...(req.user.est_id ? [req.user.est_id] : [])])).map(Number).filter(Boolean);
      if (ids.length) { params.push(ids); where.push(`a.est_id = ANY($${params.length})`); }
    } else if (['simples','recepcao'].includes(req.user.role) && req.user.est_id) {
      params.push(req.user.est_id); where.push(`a.est_id = $${params.length}`);
    } else if (req.user.role === 'professor') {
      // professor cobra só os próprios alunos
      if (req.user.professor_id) { params.push(req.user.professor_id); where.push(`a.professor_id = $${params.length}`); }
      else if (req.user.est_id)  { params.push(req.user.est_id);       where.push(`a.est_id = $${params.length}`); }
      else return res.status(403).json({ error: 'Professor sem vínculo' });
    }

    // filtro de IDs específicos
    if (Array.isArray(alunoIds) && alunoIds.length) {
      params.push(alunoIds.map(Number));
      where.push(`a.id = ANY($${params.length})`);
    }

    const { rows: alunos } = await pool.query(
      `SELECT a.* FROM alunos a WHERE ${where.join(' AND ')} ORDER BY a.nome`,
      params
    );

    const hoje = new Date();
    const results = [];
    for (const a of alunos) {
      const valor = a.mensalidade_valor ? `R$ ${Number(a.mensalidade_valor).toFixed(2).replace('.',',')}` : '';
      let msg;
      if (a.mensalidade_vencimento) {
        const venc = new Date(a.mensalidade_vencimento);
        const diffDays = Math.round((hoje - venc) / 86400000);
        if (diffDays > 0) {
          msg = `Olá, ${a.nome.split(' ')[0]}! 👋\n\nSua mensalidade${valor ? ` de ${valor}` : ''} venceu há ${diffDays} dia${diffDays !== 1 ? 's' : ''}.\n\nPor favor, entre em contato para regularizar. Obrigado! 🏆`;
        } else {
          const diasRestantes = Math.abs(diffDays);
          msg = `Olá, ${a.nome.split(' ')[0]}! 👋\n\nPassando para lembrar que sua mensalidade${valor ? ` de ${valor}` : ''} vence em ${diasRestantes} dia${diasRestantes !== 1 ? 's' : ''}.\n\nQualquer dúvida, estamos à disposição! 🏆`;
        }
      } else {
        msg = `Olá, ${a.nome.split(' ')[0]}! 👋\n\nPassando para informar que você possui${valor ? ` uma mensalidade de ${valor}` : ' uma mensalidade'} em aberto.\n\nPor favor, entre em contato para regularizar. Obrigado! 🏆`;
      }
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
router.post('/', auth, requirePerm('alunos_criar'), async (req, res) => {
  if (!canManageAluno(req.user)) return res.status(403).json({ error: 'Sem permissão' });
  const { nome, cpf, email, telefone, data_nascimento, mensalidade_valor, mensalidade_vencimento } = req.body;
  let { est_id } = req.body;
  if (['simples','recepcao'].includes(req.user.role)) est_id = req.user.est_id;
  if (req.user.role === 'professor') est_id = req.user.est_id;
  if (req.user.role === 'manager' && !est_id) {
    est_id = req.user.est_id || (req.user.est_ids && req.user.est_ids[0]) || null;
  }
  // professor usa o próprio professor_id; admin/manager/simples usam o do body
  const professor_id = req.user.role === 'professor'
    ? (req.user.professor_id || null)
    : (req.body.professor_id ? Number(req.body.professor_id) : null);
  if (!nome) return res.status(400).json({ error: 'Nome é obrigatório' });
  if (!est_id) return res.status(400).json({ error: 'Estabelecimento é obrigatório' });

  try {
    const { rows } = await pool.query(
      `INSERT INTO alunos (nome, cpf, email, telefone, data_nascimento, est_id, professor_id, mensalidade_valor, mensalidade_vencimento)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [nome, cpf || null, email || null, telefone || null, data_nascimento || null, est_id, professor_id,
       mensalidade_valor ? parseFloat(mensalidade_valor) : null, mensalidade_vencimento || null]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('[POST /alunos]', err);
    res.status(500).json({ error: 'Erro ao criar aluno' });
  }
});

// ── PUT /:id — atualiza aluno ─────────────────────────────────────
router.put('/:id', auth, requirePerm('alunos_editar'), async (req, res) => {
  if (!canManageAluno(req.user)) return res.status(403).json({ error: 'Sem permissão' });
  const { nome, cpf, email, telefone, data_nascimento, ativo, mensalidade_valor, mensalidade_vencimento } = req.body;
  let { est_id, professor_id } = req.body;
  try {
    const atual = await loadAlunoInScope(req, res);
    if (!atual) return;
    // Fora do admin/manager ninguém troca o aluno de estabelecimento;
    // professor não troca o professor responsável.
    if (!['admin', 'manager'].includes(req.user.role)) est_id = atual.est_id;
    if (req.user.role === 'manager' && est_id && !userEstIds(req.user).includes(Number(est_id))) est_id = atual.est_id;
    if (req.user.role === 'professor') professor_id = atual.professor_id;
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
router.delete('/:id', auth, requirePerm('alunos_excluir'), async (req, res) => {
  if (!canManageAluno(req.user)) return res.status(403).json({ error: 'Sem permissão' });
  try {
    const atual = await loadAlunoInScope(req, res);
    if (!atual) return;
    const { rowCount } = await pool.query('DELETE FROM alunos WHERE id = $1', [req.params.id]);
    if (!rowCount) return res.status(404).json({ error: 'Aluno não encontrado' });
    res.json({ message: 'Aluno removido' });
  } catch (err) {
    console.error('[DELETE /alunos/:id]', err);
    res.status(500).json({ error: 'Erro ao remover aluno' });
  }
});

module.exports = router;
