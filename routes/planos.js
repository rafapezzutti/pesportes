const router = require('express').Router();
const pool   = require('../db/pool');
const { auth, adminManagerOrSimples } = require('../middleware/auth');

// ── Planos de Aula ────────────────────────────────────────────────

// GET /api/planos?estId=&professorId=&status=
router.get('/', auth, async (req, res) => {
  try {
    const { estId, professorId, status } = req.query;
    const clauses = [];
    const params  = [];

    if (req.user.role === 'manager' && req.user.est_ids?.length) {
      clauses.push(`pl.est_id = ANY($${params.length + 1})`);
      params.push(req.user.est_ids);
    } else if (req.user.role === 'simples' && req.user.est_id) {
      clauses.push(`pl.est_id = $${params.length + 1}`);
      params.push(req.user.est_id);
    }

    if (estId)       { clauses.push(`pl.est_id = $${params.length + 1}`);       params.push(estId); }
    if (professorId) { clauses.push(`pl.professor_id = $${params.length + 1}`); params.push(professorId); }
    if (status)      { clauses.push(`pl.status = $${params.length + 1}`);       params.push(status); }

    const where = clauses.length ? 'WHERE ' + clauses.join(' AND ') : '';
    const { rows } = await pool.query(
      `SELECT pl.*,
              pr.nome AS professor_nome,
              e.name  AS est_name
       FROM planos_aula pl
       LEFT JOIN professores   pr ON pl.professor_id = pr.id
       LEFT JOIN establishments e  ON pl.est_id      = e.id
       ${where}
       ORDER BY pl.data_inicio DESC, pl.created_at DESC`,
      params
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao listar planos' });
  }
});

// GET /api/planos/:id
router.get('/:id', auth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT pl.*,
              pr.nome AS professor_nome,
              e.name  AS est_name
       FROM planos_aula pl
       LEFT JOIN professores   pr ON pl.professor_id = pr.id
       LEFT JOIN establishments e  ON pl.est_id      = e.id
       WHERE pl.id = $1`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Plano não encontrado' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Erro interno' });
  }
});

// POST /api/planos
router.post('/', auth, adminManagerOrSimples, async (req, res) => {
  const {
    professor_id, nome_aluno, telefone_aluno, email_aluno,
    tipo_plano, valor, recorrencia, dias_semana,
    horario_inicio, horario_fim, data_inicio, data_fim, observacoes,
  } = req.body;

  // Professores (simples) só podem criar planos na própria unidade
  const est_id = req.user.role === 'simples' ? req.user.est_id : req.body.est_id;

  if (!nome_aluno) return res.status(400).json({ error: 'Nome do aluno é obrigatório' });
  if (!tipo_plano) return res.status(400).json({ error: 'Tipo do plano é obrigatório' });

  try {
    const { rows } = await pool.query(
      `INSERT INTO planos_aula
         (est_id, professor_id, nome_aluno, telefone_aluno, email_aluno,
          tipo_plano, valor, recorrencia, dias_semana,
          horario_inicio, horario_fim, data_inicio, data_fim, observacoes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       RETURNING *`,
      [
        est_id || null,
        professor_id || null,
        nome_aluno,
        telefone_aluno || null,
        email_aluno || null,
        tipo_plano,
        valor || 0,
        recorrencia || 'nenhuma',
        dias_semana || [],
        horario_inicio || null,
        horario_fim || null,
        data_inicio || new Date().toISOString().split('T')[0],
        data_fim || null,
        observacoes || null,
      ]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao criar plano' });
  }
});

// PUT /api/planos/:id
router.put('/:id', auth, adminManagerOrSimples, async (req, res) => {
  const {
    est_id, professor_id, nome_aluno, telefone_aluno, email_aluno,
    tipo_plano, valor, recorrencia, dias_semana,
    horario_inicio, horario_fim, data_inicio, data_fim, observacoes, status,
  } = req.body;

  try {
    const { rows } = await pool.query(
      `UPDATE planos_aula SET
         est_id=$1, professor_id=$2, nome_aluno=$3, telefone_aluno=$4, email_aluno=$5,
         tipo_plano=$6, valor=$7, recorrencia=$8, dias_semana=$9,
         horario_inicio=$10, horario_fim=$11, data_inicio=$12, data_fim=$13,
         observacoes=$14, status=$15, updated_at=NOW()
       WHERE id=$16 RETURNING *`,
      [
        est_id || null, professor_id || null, nome_aluno,
        telefone_aluno || null, email_aluno || null,
        tipo_plano, valor || 0, recorrencia || 'nenhuma',
        dias_semana || [], horario_inicio || null, horario_fim || null,
        data_inicio, data_fim || null, observacoes || null,
        status || 'ativo', req.params.id,
      ]
    );
    if (!rows.length) return res.status(404).json({ error: 'Plano não encontrado' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao atualizar plano' });
  }
});

// DELETE /api/planos/:id
router.delete('/:id', auth, adminManagerOrSimples, async (req, res) => {
  try {
    await pool.query('DELETE FROM planos_aula WHERE id=$1', [req.params.id]);
    res.json({ message: 'Plano excluído' });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao excluir plano' });
  }
});

module.exports = router;
