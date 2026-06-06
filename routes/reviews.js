const router = require('express').Router();
const pool   = require('../db/pool');
const { auth } = require('../middleware/auth');

const TYPES = ['establishment', 'profissional'];

// GET /api/reviews/:type/:id — lista pública de avaliações + média
router.get('/:type/:id', async (req, res) => {
  const { type, id } = req.params;
  if (!TYPES.includes(type)) return res.status(400).json({ error: 'Tipo inválido' });
  try {
    const [list, agg] = await Promise.all([
      pool.query(
        `SELECT id, user_name, nota, comentario, created_at
         FROM reviews WHERE target_type=$1 AND target_id=$2
         ORDER BY created_at DESC LIMIT 100`, [type, id]
      ),
      pool.query(
        `SELECT COUNT(*)::int AS total, COALESCE(AVG(nota),0)::numeric(3,2) AS media
         FROM reviews WHERE target_type=$1 AND target_id=$2`, [type, id]
      ),
    ]);
    res.json({ reviews: list.rows, total: agg.rows[0].total, media: Number(agg.rows[0].media) });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao listar avaliações' });
  }
});

// POST /api/reviews — cria/atualiza avaliação (somente usuário público logado)
// body: { target_type, target_id, nota, comentario }
router.post('/', auth, async (req, res) => {
  if (req.user.type !== 'public')
    return res.status(403).json({ error: 'Apenas clientes podem avaliar' });
  const { target_type, target_id, nota, comentario } = req.body;
  if (!TYPES.includes(target_type)) return res.status(400).json({ error: 'Tipo inválido' });
  const n = parseInt(nota);
  if (!(n >= 1 && n <= 5)) return res.status(400).json({ error: 'Nota deve ser de 1 a 5' });

  try {
    const { rows: u } = await pool.query('SELECT name FROM public_users WHERE id=$1', [req.user.id]);
    const { rows } = await pool.query(
      `INSERT INTO reviews (target_type, target_id, user_id, user_name, nota, comentario)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (target_type, target_id, user_id)
       DO UPDATE SET nota=$5, comentario=$6, created_at=NOW()
       RETURNING *`,
      [target_type, target_id, req.user.id, u[0]?.name || null, n, comentario || null]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao salvar avaliação' });
  }
});

module.exports = router;
