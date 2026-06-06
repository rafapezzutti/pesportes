const router = require('express').Router();
const pool   = require('../db/pool');
const { auth, adminOrManager } = require('../middleware/auth');

// GET /api/professores?estId=
router.get('/', auth, async (req, res) => {
  try {
    const { estId } = req.query;
    const clauses = [];
    const params  = [];

    if (req.user.role === 'manager' && req.user.est_ids?.length) {
      clauses.push(`p.est_id = ANY($${params.length + 1})`);
      params.push(req.user.est_ids);
    } else if (req.user.role === 'simples' && req.user.est_id) {
      clauses.push(`p.est_id = $${params.length + 1}`);
      params.push(req.user.est_id);
    }

    if (estId) {
      clauses.push(`p.est_id = $${params.length + 1}`);
      params.push(estId);
    }

    const where = clauses.length ? 'WHERE ' + clauses.join(' AND ') : '';
    const { rows } = await pool.query(
      `SELECT p.*, e.name AS est_name
       FROM professores p
       LEFT JOIN establishments e ON p.est_id = e.id
       ${where}
       ORDER BY p.nome`,
      params
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao listar professores' });
  }
});

// GET /api/professores/:id
router.get('/:id', auth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT p.*, e.name AS est_name
       FROM professores p
       LEFT JOIN establishments e ON p.est_id = e.id
       WHERE p.id = $1`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Professor não encontrado' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Erro interno' });
  }
});

// POST /api/professores
router.post('/', auth, adminOrManager, async (req, res) => {
  const { est_id, nome, cpf, data_nascimento, email, telefone, valor_hora_avulso, percentual_repasse } = req.body;
  if (!nome) return res.status(400).json({ error: 'Nome é obrigatório' });

  try {
    const { rows } = await pool.query(
      `INSERT INTO professores (est_id, nome, cpf, data_nascimento, email, telefone, valor_hora_avulso, percentual_repasse)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [est_id || null, nome, cpf || null, data_nascimento || null,
       email || null, telefone || null, valor_hora_avulso || 0, percentual_repasse || 0]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao criar professor' });
  }
});

// PUT /api/professores/:id
router.put('/:id', auth, adminOrManager, async (req, res) => {
  const { est_id, nome, cpf, data_nascimento, email, telefone, valor_hora_avulso, percentual_repasse, ativo } = req.body;
  try {
    const { rows } = await pool.query(
      `UPDATE professores SET
         est_id=$1, nome=$2, cpf=$3, data_nascimento=$4,
         email=$5, telefone=$6, valor_hora_avulso=$7, percentual_repasse=$8, ativo=$9, updated_at=NOW()
       WHERE id=$10 RETURNING *`,
      [est_id || null, nome, cpf || null, data_nascimento || null,
       email || null, telefone || null, valor_hora_avulso || 0, percentual_repasse || 0,
       ativo !== false, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Professor não encontrado' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao atualizar professor' });
  }
});

// DELETE /api/professores/:id
router.delete('/:id', auth, adminOrManager, async (req, res) => {
  try {
    await pool.query('DELETE FROM professores WHERE id=$1', [req.params.id]);
    res.json({ message: 'Professor excluído' });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao excluir professor' });
  }
});

module.exports = router;
