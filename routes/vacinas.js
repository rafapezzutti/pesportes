const router = require('express').Router();
const pool   = require('../db/pool');
const { auth, adminOrManager } = require('../middleware/auth');

// ── GET / — lista vacinas (filtrado por est do usuário) ───────────
router.get('/', auth, async (req, res) => {
  try {
    const params = [];
    const where  = [];

    if (req.user.role === 'manager' && req.user.est_ids?.length) {
      params.push(req.user.est_ids);
      where.push(`v.est_id = ANY($${params.length})`);
    } else if (req.user.role === 'simples' && req.user.est_id) {
      params.push(req.user.est_id);
      where.push(`v.est_id = $${params.length}`);
    }

    // filtro opcional por aluno
    if (req.query.aluno_id) {
      params.push(req.query.aluno_id);
      where.push(`v.aluno_id = $${params.length}`);
    }

    const ws = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const { rows } = await pool.query(
      `SELECT v.*,
              a.nome  AS aluno_nome,
              a.email AS aluno_email,
              e.name  AS est_name
       FROM aluno_vacinas v
       JOIN alunos        a ON v.aluno_id = a.id
       LEFT JOIN establishments e ON v.est_id = e.id
       ${ws}
       ORDER BY v.data_proxima_dose ASC NULLS LAST, a.nome`,
      params
    );
    res.json(rows);
  } catch (err) {
    console.error('[GET /vacinas]', err);
    res.status(500).json({ error: 'Erro ao listar vacinas' });
  }
});

// ── POST / — cria registro ────────────────────────────────────────
router.post('/', auth, adminOrManager, async (req, res) => {
  const { aluno_id, est_id, nome_vacina, data_aplicacao, data_proxima_dose, observacoes } = req.body;
  if (!aluno_id || !nome_vacina)
    return res.status(400).json({ error: 'aluno_id e nome_vacina são obrigatórios' });

  try {
    const { rows } = await pool.query(
      `INSERT INTO aluno_vacinas
         (aluno_id, est_id, nome_vacina, data_aplicacao, data_proxima_dose, observacoes)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING *`,
      [aluno_id, est_id || null, nome_vacina,
       data_aplicacao || null, data_proxima_dose || null, observacoes || null]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('[POST /vacinas]', err);
    res.status(500).json({ error: 'Erro ao criar vacina' });
  }
});

// ── PUT /:id — atualiza ───────────────────────────────────────────
router.put('/:id', auth, adminOrManager, async (req, res) => {
  const { nome_vacina, data_aplicacao, data_proxima_dose, observacoes, lembrete_enviado } = req.body;
  try {
    const { rows } = await pool.query(
      `UPDATE aluno_vacinas SET
         nome_vacina       = COALESCE($1, nome_vacina),
         data_aplicacao    = COALESCE($2, data_aplicacao),
         data_proxima_dose = $3,
         observacoes       = COALESCE($4, observacoes),
         lembrete_enviado  = COALESCE($5, lembrete_enviado),
         updated_at        = NOW()
       WHERE id = $6
       RETURNING *`,
      [nome_vacina || null, data_aplicacao || null,
       data_proxima_dose || null,
       observacoes || null,
       lembrete_enviado !== undefined ? lembrete_enviado : null,
       req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Registro não encontrado' });
    res.json(rows[0]);
  } catch (err) {
    console.error('[PUT /vacinas/:id]', err);
    res.status(500).json({ error: 'Erro ao atualizar vacina' });
  }
});

// ── DELETE /:id ───────────────────────────────────────────────────
router.delete('/:id', auth, adminOrManager, async (req, res) => {
  try {
    const { rowCount } = await pool.query('DELETE FROM aluno_vacinas WHERE id = $1', [req.params.id]);
    if (!rowCount) return res.status(404).json({ error: 'Registro não encontrado' });
    res.json({ message: 'Removido' });
  } catch (err) {
    console.error('[DELETE /vacinas/:id]', err);
    res.status(500).json({ error: 'Erro ao remover' });
  }
});

module.exports = router;
