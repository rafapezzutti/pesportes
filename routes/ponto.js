const router = require('express').Router();
const pool   = require('../db/pool');
const { auth, adminOrManager } = require('../middleware/auth');

// GET /api/ponto?employeeId=&from=&to=
router.get('/', auth, adminOrManager, async (req, res) => {
  const { employeeId, from, to } = req.query;
  const params = [];
  const where = [];
  if (employeeId) { params.push(employeeId); where.push(`p.employee_id = $${params.length}`); }
  if (from)       { params.push(from);       where.push(`p.data >= $${params.length}`); }
  if (to)         { params.push(to);         where.push(`p.data <= $${params.length}`); }
  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
  try {
    const { rows } = await pool.query(
      `SELECT p.*, e.nome AS employee_nome FROM ponto_registros p
       JOIN employees e ON e.id = p.employee_id
       ${whereSql} ORDER BY p.data DESC`, params
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: 'Erro ao listar ponto' }); }
});

// POST /api/ponto — cria ou atualiza o registro do dia (UNIQUE employee_id+data)
router.post('/', auth, adminOrManager, async (req, res) => {
  const { employee_id, data, entrada, saida, tipo, observacoes } = req.body;
  if (!employee_id || !data) return res.status(400).json({ error: 'Funcionário e data obrigatórios' });
  // calcula horas se entrada/saida informados
  let horas = 0;
  if (entrada && saida) {
    const [eh, em] = entrada.split(':').map(Number);
    const [sh, sm] = saida.split(':').map(Number);
    horas = Math.max(0, ((sh * 60 + sm) - (eh * 60 + em)) / 60);
  }
  try {
    const { rows } = await pool.query(
      `INSERT INTO ponto_registros (employee_id, data, entrada, saida, horas, tipo, observacoes)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (employee_id, data)
       DO UPDATE SET entrada=$3, saida=$4, horas=$5, tipo=$6, observacoes=$7
       RETURNING *`,
      [employee_id, data, entrada || null, saida || null, horas, tipo || 'normal', observacoes || null]
    );
    res.status(201).json(rows[0]);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Erro ao registrar ponto' }); }
});

// DELETE /api/ponto/:id
router.delete('/:id', auth, adminOrManager, async (req, res) => {
  try {
    await pool.query('DELETE FROM ponto_registros WHERE id=$1', [req.params.id]);
    res.json({ message: 'Registro excluído' });
  } catch (err) { res.status(500).json({ error: 'Erro ao excluir registro' }); }
});

module.exports = router;
