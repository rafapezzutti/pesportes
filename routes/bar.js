const router = require('express').Router();
const pool   = require('../db/pool');
const { auth, adminOrManager } = require('../middleware/auth');

// Retorna lista combinada de clientes (para dropdown)
router.get('/clientes', auth, async (req, res) => {
  try {
    const clauses = [];
    const params  = [];

    // Filtro por estabelecimento se for gerente/simples
    let estFilter = '';
    if (req.user.role === 'manager') {
      const ids = Array.from(new Set([
        ...(req.user.est_ids || []),
        ...(req.user.est_id ? [req.user.est_id] : []),
      ])).map(Number).filter(Boolean);
      if (ids.length) { estFilter = `AND est_id = ANY($1)`; params.push(ids); }
    } else if (req.user.role === 'simples' && req.user.est_id) {
      estFilter = `AND est_id = $1`;
      params.push(req.user.est_id);
    }

    const pidx = params.length ? `$${params.length}` : null;

    const { rows } = await pool.query(`
      SELECT DISTINCT nome FROM (
        SELECT name AS nome FROM public_users
        UNION
        SELECT nome FROM alunos WHERE ativo = TRUE ${estFilter ? estFilter : ''}
        UNION
        SELECT client_name AS nome FROM reservations WHERE client_name IS NOT NULL ${estFilter ? estFilter : ''}
        UNION
        SELECT nome_aluno AS nome FROM planos_aula WHERE nome_aluno IS NOT NULL ${estFilter ? estFilter : ''}
        UNION
        SELECT cliente_nome AS nome FROM bar_vendas WHERE cliente_nome IS NOT NULL ${estFilter ? estFilter : ''}
        UNION
        SELECT cliente_nome AS nome FROM manutencao_vendas WHERE cliente_nome IS NOT NULL ${estFilter ? estFilter : ''}
      ) AS t
      WHERE nome IS NOT NULL AND nome != ''
      ORDER BY nome
    `, params);

    res.json(rows.map(r => r.nome));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao listar clientes' });
  }
});

// GET /api/bar?estId=&clienteNome=
router.get('/', auth, async (req, res) => {
  try {
    const { estId, clienteNome } = req.query;
    const clauses = [];
    const params  = [];

    if (req.user.role === 'manager') {
      const ids = Array.from(new Set([
        ...(req.user.est_ids || []),
        ...(req.user.est_id ? [req.user.est_id] : []),
      ])).map(Number).filter(Boolean);
      if (ids.length) { clauses.push(`est_id = ANY($${params.length + 1})`); params.push(ids); }
    } else if (req.user.role === 'simples' && req.user.est_id) {
      clauses.push(`est_id = $${params.length + 1}`);
      params.push(req.user.est_id);
    }

    if (estId)       { clauses.push(`est_id = $${params.length + 1}`);        params.push(estId); }
    if (clienteNome) { clauses.push(`cliente_nome ILIKE $${params.length+1}`); params.push(`%${clienteNome}%`); }

    const where = clauses.length ? 'WHERE ' + clauses.join(' AND ') : '';
    const { rows } = await pool.query(
      `SELECT b.*, e.name AS est_name
       FROM bar_vendas b
       LEFT JOIN establishments e ON b.est_id = e.id
       ${where}
       ORDER BY b.data_venda DESC, b.created_at DESC`,
      params
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao listar vendas do bar' });
  }
});

// POST /api/bar
router.post('/', auth, adminOrManager, async (req, res) => {
  const { est_id, cliente_nome, aluno_id, cliente_ref, itens, observacoes, data_venda, foto, forma_pgto } = req.body;
  if (!cliente_nome) return res.status(400).json({ error: 'Nome do cliente é obrigatório' });
  if (!itens || !itens.length) return res.status(400).json({ error: 'Adicione ao menos um item' });

  const total = itens.reduce((s, i) => s + (Number(i.quantidade) * Number(i.valor_unitario)), 0);
  const dataFinal = data_venda || new Date().toISOString().split('T')[0];

  try {
    const { rows } = await pool.query(
      `INSERT INTO bar_vendas (est_id, cliente_nome, aluno_id, cliente_ref, itens, total, observacoes, data_venda, foto, forma_pgto, status_pgto)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'pendente') RETURNING *`,
      [est_id || null, cliente_nome, aluno_id || null, cliente_ref || 'manual',
       JSON.stringify(itens), total, observacoes || null, dataFinal,
       foto || null, forma_pgto || null]
    );

    // Baixa de estoque (#10): se o item referencia um produto cadastrado, decrementa.
    for (const it of itens) {
      const qtd = Number(it.quantidade) || 0;
      if (qtd <= 0) continue;
      if (it.produto_id) {
        await pool.query('UPDATE bar_produtos SET estoque = estoque - $1, updated_at = NOW() WHERE id = $2',
          [qtd, it.produto_id]).catch(() => {});
      } else if (est_id && it.nome) {
        await pool.query(
          'UPDATE bar_produtos SET estoque = estoque - $1, updated_at = NOW() WHERE est_id = $2 AND LOWER(nome) = LOWER($3)',
          [qtd, est_id, it.nome]).catch(() => {});
      }
    }

    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao registrar venda do bar' });
  }
});

// PATCH /api/bar/:id/pgto — atualiza status e forma de pagamento
router.patch('/:id/pgto', auth, adminOrManager, async (req, res) => {
  const { status_pgto, forma_pgto } = req.body;
  try {
    const { rows } = await pool.query(
      `UPDATE bar_vendas SET
         status_pgto = COALESCE($1, status_pgto),
         forma_pgto  = COALESCE($2, forma_pgto)
       WHERE id = $3 RETURNING *`,
      [status_pgto || null, forma_pgto || null, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Venda não encontrada' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao atualizar pagamento' });
  }
});

// DELETE /api/bar/:id
router.delete('/:id', auth, adminOrManager, async (req, res) => {
  try {
    await pool.query('DELETE FROM bar_vendas WHERE id=$1', [req.params.id]);
    res.json({ message: 'Venda excluída' });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao excluir venda' });
  }
});

module.exports = router;
