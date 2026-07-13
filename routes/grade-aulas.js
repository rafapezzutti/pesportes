/**
 * Grade de Aulas — /api/grade-aulas
 * Slots semanais (recorrentes) e por dia para professores.
 */
const router = require('express').Router();
const pool   = require('../db/pool');
const { auth } = require('../middleware/auth');

function canManage(user) {
  return ['admin','manager','simples','professor'].includes(user.role);
}

function estScope(user) {
  if (user.role === 'admin') return null;
  const ids = Array.from(new Set([
    ...(user.est_ids || []),
    ...(user.est_id ? [user.est_id] : []),
  ])).map(Number).filter(Boolean);
  return ids.length ? ids : null;
}

// ── GET / ──────────────────────────────────────────────────────────────────────
// ?semana=true  → slots recorrentes (dia_semana IS NOT NULL)
// ?data=YYYY-MM-DD → slots daquele dia (recorrentes do dia_semana + específicos)
// ?est_id=X
router.get('/', auth, async (req, res) => {
  if (!canManage(req.user)) return res.status(403).json({ error: 'Sem permissão' });
  try {
    const ids = estScope(req.user);
    const { est_id, data } = req.query;
    const params = [];
    const where  = ['ga.ativo = TRUE'];

    if (est_id) {
      params.push(Number(est_id));
      where.push(`ga.est_id = $${params.length}`);
    } else if (ids) {
      params.push(ids);
      where.push(`ga.est_id = ANY($${params.length})`);
    }

    if (req.user.role === 'professor' && req.user.professor_id) {
      params.push(req.user.professor_id);
      where.push(`ga.professor_id = $${params.length}`);
    }

    if (data) {
      // dia da semana 0=Dom…6=Sáb
      const dow = new Date(data + 'T12:00:00').getDay();
      params.push(data);
      params.push(dow);
      where.push(`(ga.data = $${params.length - 1} OR (ga.data IS NULL AND ga.dia_semana = $${params.length}))`);
    } else {
      // modo semanal: apenas recorrentes
      where.push('ga.dia_semana IS NOT NULL AND ga.data IS NULL');
    }

    const { rows } = await pool.query(`
      SELECT ga.*,
             p.nome AS professor_nome,
             e.name AS est_name,
             COALESCE(
               json_agg(
                 json_build_object('id',a.id,'nome',a.nome,'telefone',a.telefone)
                 ORDER BY a.nome
               ) FILTER (WHERE a.id IS NOT NULL),
               '[]'::json
             ) AS alunos
      FROM grade_aulas ga
      LEFT JOIN professores  p  ON ga.professor_id = p.id
      LEFT JOIN establishments e ON ga.est_id = e.id
      LEFT JOIN grade_aula_alunos gaa ON gaa.grade_aula_id = ga.id
      LEFT JOIN alunos a ON gaa.aluno_id = a.id
      WHERE ${where.join(' AND ')}
      GROUP BY ga.id, p.nome, e.name
      ORDER BY ga.hora, p.nome
    `, params);

    res.json(rows);
  } catch (err) {
    console.error('[GET /grade-aulas]', err);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /resumo ────────────────────────────────────────────────────────────────
router.get('/resumo', auth, async (req, res) => {
  if (!canManage(req.user)) return res.status(403).json({ error: 'Sem permissão' });
  try {
    const ids = estScope(req.user);
    const { est_id } = req.query;
    const params = [];
    const where  = ['ga.ativo = TRUE', "ga.dia_semana IS NOT NULL AND ga.data IS NULL"];

    if (est_id) {
      params.push(Number(est_id));
      where.push(`ga.est_id = $${params.length}`);
    } else if (ids) {
      params.push(ids);
      where.push(`ga.est_id = ANY($${params.length})`);
    }

    if (req.user.role === 'professor' && req.user.professor_id) {
      params.push(req.user.professor_id);
      where.push(`ga.professor_id = $${params.length}`);
    }

    const { rows } = await pool.query(`
      SELECT
        p.id   AS professor_id,
        p.nome AS professor_nome,
        COUNT(DISTINCT ga.id)                                    AS total_slots,
        COALESCE(SUM(cnt.n),0)                                   AS total_alunos,
        COALESCE(SUM(cnt.n * ga.valor_por_aluno),0)              AS receita_semanal
      FROM grade_aulas ga
      JOIN professores p ON ga.professor_id = p.id
      LEFT JOIN (
        SELECT grade_aula_id, COUNT(*) AS n
        FROM grade_aula_alunos
        GROUP BY grade_aula_id
      ) cnt ON cnt.grade_aula_id = ga.id
      WHERE ${where.join(' AND ')}
      GROUP BY p.id, p.nome
      ORDER BY p.nome
    `, params);

    res.json(rows);
  } catch (err) {
    console.error('[GET /grade-aulas/resumo]', err);
    res.status(500).json({ error: err.message });
  }
});

// ── POST / ─────────────────────────────────────────────────────────────────────
router.post('/', auth, async (req, res) => {
  if (!canManage(req.user)) return res.status(403).json({ error: 'Sem permissão' });
  const { professor_id, est_id, dia_semana, data, hora, max_alunos, valor_por_aluno } = req.body;
  if (!hora) return res.status(400).json({ error: 'hora obrigatória' });
  if (dia_semana == null && !data) return res.status(400).json({ error: 'dia_semana ou data obrigatório' });

  let resolvedEstId = est_id || null;
  if (!resolvedEstId && req.user.role !== 'admin') {
    resolvedEstId = req.user.est_id || (req.user.est_ids && req.user.est_ids[0]) || null;
  }

  try {
    // checar duplicata no mesmo dia/hora/professor
    const dup = await pool.query(
      `SELECT id FROM grade_aulas
       WHERE professor_id=$1 AND est_id=$2 AND hora=$3
         AND ativo=TRUE
         AND ($4::integer IS NULL OR dia_semana=$4)
         AND ($5::date IS NULL OR data=$5)`,
      [professor_id||null, resolvedEstId, hora, dia_semana??null, data||null]
    );
    if (dup.rows.length) return res.status(409).json({ error: 'Já existe um slot para esse professor nesse horário' });

    const { rows } = await pool.query(`
      INSERT INTO grade_aulas (professor_id, est_id, dia_semana, data, hora, max_alunos, valor_por_aluno)
      VALUES ($1,$2,$3,$4,$5,$6,$7)
      RETURNING *
    `, [professor_id||null, resolvedEstId, dia_semana??null, data||null,
        hora, max_alunos||4, valor_por_aluno||0]);
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('[POST /grade-aulas]', err);
    res.status(500).json({ error: err.message });
  }
});

// ── PUT /:id ───────────────────────────────────────────────────────────────────
router.put('/:id', auth, async (req, res) => {
  if (!canManage(req.user)) return res.status(403).json({ error: 'Sem permissão' });
  const { professor_id, max_alunos, valor_por_aluno, hora, ativo } = req.body;
  try {
    const { rows } = await pool.query(`
      UPDATE grade_aulas SET
        professor_id    = COALESCE($1, professor_id),
        max_alunos      = COALESCE($2, max_alunos),
        valor_por_aluno = COALESCE($3, valor_por_aluno),
        hora            = COALESCE($4, hora),
        ativo           = COALESCE($5, ativo)
      WHERE id = $6
      RETURNING *
    `, [professor_id||null, max_alunos||null,
        valor_por_aluno != null ? Number(valor_por_aluno) : null,
        hora||null,
        ativo !== undefined ? ativo : null,
        req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Slot não encontrado' });
    res.json(rows[0]);
  } catch (err) {
    console.error('[PUT /grade-aulas/:id]', err);
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /:id ────────────────────────────────────────────────────────────────
router.delete('/:id', auth, async (req, res) => {
  if (!canManage(req.user)) return res.status(403).json({ error: 'Sem permissão' });
  try {
    const { rowCount } = await pool.query(
      'DELETE FROM grade_aulas WHERE id=$1', [req.params.id]
    );
    if (!rowCount) return res.status(404).json({ error: 'Slot não encontrado' });
    res.json({ ok: true });
  } catch (err) {
    console.error('[DELETE /grade-aulas/:id]', err);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /:id/alunos — adiciona aluno ao slot ──────────────────────────────────
router.post('/:id/alunos', auth, async (req, res) => {
  if (!canManage(req.user)) return res.status(403).json({ error: 'Sem permissão' });
  const { aluno_id } = req.body;
  if (!aluno_id) return res.status(400).json({ error: 'aluno_id obrigatório' });
  try {
    // checar se slot está cheio
    const { rows: info } = await pool.query(
      `SELECT ga.max_alunos, COUNT(gaa.id) AS atual
       FROM grade_aulas ga
       LEFT JOIN grade_aula_alunos gaa ON gaa.grade_aula_id = ga.id
       WHERE ga.id = $1
       GROUP BY ga.max_alunos`,
      [req.params.id]
    );
    if (!info.length) return res.status(404).json({ error: 'Slot não encontrado' });
    if (Number(info[0].atual) >= Number(info[0].max_alunos)) {
      return res.status(400).json({ error: `Slot cheio (máx ${info[0].max_alunos} alunos)` });
    }
    await pool.query(
      `INSERT INTO grade_aula_alunos (grade_aula_id, aluno_id)
       VALUES ($1,$2) ON CONFLICT DO NOTHING`,
      [req.params.id, aluno_id]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('[POST /grade-aulas/:id/alunos]', err);
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /:id/alunos/:alunoId ───────────────────────────────────────────────
router.delete('/:id/alunos/:alunoId', auth, async (req, res) => {
  if (!canManage(req.user)) return res.status(403).json({ error: 'Sem permissão' });
  try {
    await pool.query(
      'DELETE FROM grade_aula_alunos WHERE grade_aula_id=$1 AND aluno_id=$2',
      [req.params.id, req.params.alunoId]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('[DELETE /grade-aulas/:id/alunos]', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
