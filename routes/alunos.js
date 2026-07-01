const router = require('express').Router();
const pool   = require('../db/pool');
const { auth, adminOnly, adminOrManager } = require('../middleware/auth');

// simples também pode gerenciar alunos do seu est
function canManageAluno(user) {
  return ['admin','manager','simples'].includes(user.role);
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
    }

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

// ── POST / — cria aluno ───────────────────────────────────────────
router.post('/', auth, async (req, res) => {
  if (!canManageAluno(req.user)) return res.status(403).json({ error: 'Sem permissão' });
  const { nome, cpf, email, telefone, data_nascimento } = req.body;
  let { est_id } = req.body;
  if (req.user.role === 'simples') est_id = req.user.est_id; // força est do professor
  if (!nome) return res.status(400).json({ error: 'Nome é obrigatório' });

  try {
    const { rows } = await pool.query(
      `INSERT INTO alunos (nome, cpf, email, telefone, data_nascimento, est_id)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [nome, cpf || null, email || null, telefone || null, data_nascimento || null, est_id || null]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('[POST /alunos]', err);
    res.status(500).json({ error: 'Erro ao criar aluno' });
  }
});

// ── PUT /:id — atualiza aluno ─────────────────────────────────────
router.put('/:id', auth, async (req, res) => {
  const { nome, cpf, email, telefone, data_nascimento, est_id, ativo } = req.body;
  try {
    const { rows } = await pool.query(
      `UPDATE alunos SET
         nome            = COALESCE($1, nome),
         cpf             = COALESCE($2, cpf),
         email           = COALESCE($3, email),
         telefone        = COALESCE($4, telefone),
         data_nascimento = COALESCE($5, data_nascimento),
         est_id          = COALESCE($6, est_id),
         ativo           = COALESCE($7, ativo),
         updated_at      = NOW()
       WHERE id = $8
       RETURNING *`,
      [nome || null, cpf || null, email || null, telefone || null,
       data_nascimento || null, est_id || null,
       ativo !== undefined ? ativo : null, req.params.id]
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
