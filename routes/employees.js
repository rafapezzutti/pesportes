const router = require('express').Router();
const pool   = require('../db/pool');
const { auth, adminOrManager } = require('../middleware/auth');

function scope(req, params) {
  const clauses = [];
  if (req.user.role === 'manager' && req.user.est_ids?.length) {
    params.push(req.user.est_ids); clauses.push(`e.est_id = ANY($${params.length})`);
  } else if (req.user.role === 'simples' && req.user.est_id) {
    params.push(req.user.est_id); clauses.push(`e.est_id = $${params.length}`);
  }
  return clauses;
}

// GET /api/employees?estId=&tipo=&ativo=
router.get('/', auth, adminOrManager, async (req, res) => {
  const { estId, tipo, ativo } = req.query;
  const params = [];
  const where = scope(req, params);
  if (estId) { params.push(estId); where.push(`e.est_id = $${params.length}`); }
  if (tipo)  { params.push(tipo);  where.push(`e.tipo = $${params.length}`); }
  if (ativo === 'true')  where.push('e.ativo = TRUE');
  if (ativo === 'false') where.push('e.ativo = FALSE');
  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
  try {
    const { rows } = await pool.query(
      `SELECT e.*, est.name AS est_name,
              (e.salario_base + e.encargos + e.beneficios + e.vale_transporte) AS custo_mensal
       FROM employees e LEFT JOIN establishments est ON est.id = e.est_id
       ${whereSql} ORDER BY e.ativo DESC, e.nome`, params
    );
    res.json(rows);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Erro ao listar funcionários' }); }
});

// GET /api/employees/folha?estId=  — resumo de custo mensal (CLT + PJ)
router.get('/folha', auth, adminOrManager, async (req, res) => {
  const { estId } = req.query;
  const params = [];
  const where = scope(req, params);
  where.push('e.ativo = TRUE');
  if (estId) { params.push(estId); where.push(`e.est_id = $${params.length}`); }
  const whereSql = 'WHERE ' + where.join(' AND ');
  try {
    const { rows } = await pool.query(
      `SELECT e.tipo,
              COUNT(*)::int AS qtd,
              COALESCE(SUM(e.salario_base),0)    AS salarios,
              COALESCE(SUM(e.encargos),0)        AS encargos,
              COALESCE(SUM(e.beneficios),0)      AS beneficios,
              COALESCE(SUM(e.vale_transporte),0) AS vale_transporte,
              COALESCE(SUM(e.salario_base + e.encargos + e.beneficios + e.vale_transporte),0) AS total
       FROM employees e ${whereSql} GROUP BY e.tipo`, params
    );
    const total = rows.reduce((s, r) => s + Number(r.total), 0);
    res.json({ por_tipo: rows, total_mensal: total });
  } catch (err) { res.status(500).json({ error: 'Erro ao calcular folha' }); }
});

// POST /api/employees
router.post('/', auth, adminOrManager, async (req, res) => {
  const b = req.body;
  if (!b.nome) return res.status(400).json({ error: 'Nome é obrigatório' });
  try {
    const { rows } = await pool.query(
      `INSERT INTO employees
         (est_id, tipo, nome, cargo, cpf_cnpj, email, telefone,
          salario_base, encargos, beneficios, vale_transporte, dia_pagamento,
          data_admissao, data_demissao, ativo, observacoes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *`,
      [b.est_id || null, b.tipo || 'clt', b.nome, b.cargo || null, b.cpf_cnpj || null,
       b.email || null, b.telefone || null, b.salario_base || 0, b.encargos || 0,
       b.beneficios || 0, b.vale_transporte || 0, b.dia_pagamento || 5,
       b.data_admissao || null, b.data_demissao || null, b.ativo !== false, b.observacoes || null]
    );
    res.status(201).json(rows[0]);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Erro ao criar funcionário' }); }
});

// PUT /api/employees/:id
router.put('/:id', auth, adminOrManager, async (req, res) => {
  const b = req.body;
  try {
    const { rows } = await pool.query(
      `UPDATE employees SET
         est_id=$1, tipo=$2, nome=$3, cargo=$4, cpf_cnpj=$5, email=$6, telefone=$7,
         salario_base=$8, encargos=$9, beneficios=$10, vale_transporte=$11, dia_pagamento=$12,
         data_admissao=$13, data_demissao=$14, ativo=$15, observacoes=$16, updated_at=NOW()
       WHERE id=$17 RETURNING *`,
      [b.est_id || null, b.tipo || 'clt', b.nome, b.cargo || null, b.cpf_cnpj || null,
       b.email || null, b.telefone || null, b.salario_base || 0, b.encargos || 0,
       b.beneficios || 0, b.vale_transporte || 0, b.dia_pagamento || 5,
       b.data_admissao || null, b.data_demissao || null, b.ativo !== false, b.observacoes || null,
       req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Funcionário não encontrado' });
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: 'Erro ao atualizar funcionário' }); }
});

// DELETE /api/employees/:id
router.delete('/:id', auth, adminOrManager, async (req, res) => {
  try {
    await pool.query('DELETE FROM employees WHERE id=$1', [req.params.id]);
    res.json({ message: 'Funcionário excluído' });
  } catch (err) { res.status(500).json({ error: 'Erro ao excluir funcionário' }); }
});

module.exports = router;
