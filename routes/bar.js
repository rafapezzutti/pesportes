const router = require('express').Router();
const pool   = require('../db/pool');
const { auth, adminOrManager, crmOnly } = require('../middleware/auth');

/** Roles com est_id único (não admin, não manager) */
const SINGLE_EST_ROLES = ['simples', 'professor', 'recepcao', 'profissional'];

/**
 * Adiciona cláusulas de escopo por estabelecimento ao array de clauses/params.
 * Admin não recebe filtro.
 */
function addEstScope(req, clauses, params) {
  if (req.user.role === 'manager') {
    const ids = Array.from(new Set([
      ...(req.user.est_ids || []),
      ...(req.user.est_id ? [req.user.est_id] : []),
    ])).map(Number).filter(Boolean);
    if (ids.length) { clauses.push(`est_id = ANY($${params.length + 1})`); params.push(ids); }
  } else if (SINGLE_EST_ROLES.includes(req.user.role) && req.user.est_id) {
    clauses.push(`est_id = $${params.length + 1}`);
    params.push(req.user.est_id);
  }
}

/**
 * Verifica se o usuário tem acesso ao est_id informado.
 */
function estAllowed(req, estId) {
  if (req.user.role === 'admin') return true;
  if (req.user.role === 'manager') {
    const ids = Array.from(new Set([
      ...(req.user.est_ids || []),
      ...(req.user.est_id ? [req.user.est_id] : []),
    ])).map(Number).filter(Boolean);
    return ids.includes(Number(estId));
  }
  return Number(req.user.est_id) === Number(estId);
}

// Retorna lista combinada de clientes (para dropdown)
router.get('/clientes', auth, async (req, res) => {
  try {
    const params  = [];
    const clauses = [];
    addEstScope(req, clauses, params);

    const estFilter = clauses.length ? 'AND ' + clauses.join(' AND ') : '';

    const { rows } = await pool.query(`
      SELECT DISTINCT nome FROM (
        SELECT name AS nome FROM public_users
        UNION
        SELECT nome FROM alunos WHERE ativo = TRUE ${estFilter}
        UNION
        SELECT client_name AS nome FROM reservations WHERE client_name IS NOT NULL ${estFilter}
        UNION
        SELECT nome_aluno AS nome FROM planos_aula WHERE nome_aluno IS NOT NULL ${estFilter}
        UNION
        SELECT cliente_nome AS nome FROM bar_vendas WHERE cliente_nome IS NOT NULL ${estFilter}
        UNION
        SELECT cliente_nome AS nome FROM manutencao_vendas WHERE cliente_nome IS NOT NULL ${estFilter}
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

    // Scope obrigatório por role — ignora estId do query se o usuário já tem escopo forçado
    addEstScope(req, clauses, params);

    // Admin e manager podem filtrar por estId adicional (dentro do seu escopo)
    if (estId && (req.user.role === 'admin' || req.user.role === 'manager')) {
      if (estAllowed(req, estId)) {
        // Para admin: adiciona filtro direto. Para manager: restringe ainda mais.
        clauses.push(`est_id = $${params.length + 1}`);
        params.push(estId);
      }
    }

    if (clienteNome) { clauses.push(`cliente_nome ILIKE $${params.length + 1}`); params.push(`%${clienteNome}%`); }

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
router.post('/', auth, crmOnly, async (req, res) => {
  const { est_id, cliente_nome, aluno_id, cliente_ref, itens, observacoes, data_venda, foto, forma_pgto } = req.body;
  if (!cliente_nome) return res.status(400).json({ error: 'Nome do cliente é obrigatório' });
  if (!itens || !itens.length) return res.status(400).json({ error: 'Adicione ao menos um item' });

  // Garante que o usuário não pode postar em outro estabelecimento
  const effectiveEstId = SINGLE_EST_ROLES.includes(req.user.role) ? req.user.est_id : (est_id || null);
  if (!estAllowed(req, effectiveEstId)) return res.status(403).json({ error: 'Sem permissão para este estabelecimento' });

  const total = itens.reduce((s, i) => s + (Number(i.quantidade) * Number(i.valor_unitario)), 0);
  const dataFinal = data_venda || new Date().toISOString().split('T')[0];

  try {
    const { rows } = await pool.query(
      `INSERT INTO bar_vendas (est_id, cliente_nome, cliente_ref, itens, total, observacoes, data_venda, foto, forma_pgto, status_pgto)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'pendente') RETURNING *`,
      [effectiveEstId, cliente_nome, cliente_ref || 'manual',
       JSON.stringify(itens), total, observacoes || null, dataFinal,
       foto || null, forma_pgto || null]
    );

    if (aluno_id && rows[0]?.id) {
      await pool.query(
        'UPDATE bar_vendas SET aluno_id = $1 WHERE id = $2',
        [aluno_id, rows[0].id]
      ).catch(() => {});
    }

    for (const it of itens) {
      const qtd = Number(it.quantidade) || 0;
      if (qtd <= 0) continue;
      if (it.produto_id) {
        await pool.query('UPDATE bar_produtos SET estoque = estoque - $1, updated_at = NOW() WHERE id = $2',
          [qtd, it.produto_id]).catch(() => {});
      } else if (effectiveEstId && it.nome) {
        await pool.query(
          'UPDATE bar_produtos SET estoque = estoque - $1, updated_at = NOW() WHERE est_id = $2 AND LOWER(nome) = LOWER($3)',
          [qtd, effectiveEstId, it.nome]).catch(() => {});
      }
    }

    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao registrar venda do bar' });
  }
});

// PATCH /api/bar/:id/pgto — atualiza status e forma de pagamento
router.patch('/:id/pgto', auth, crmOnly, async (req, res) => {
  const { status_pgto, forma_pgto } = req.body;
  try {
    // Verifica propriedade antes de atualizar
    const { rows: existing } = await pool.query('SELECT est_id FROM bar_vendas WHERE id=$1', [req.params.id]);
    if (!existing.length) return res.status(404).json({ error: 'Venda não encontrada' });
    if (!estAllowed(req, existing[0].est_id)) return res.status(403).json({ error: 'Sem permissão' });

    const { rows } = await pool.query(
      `UPDATE bar_vendas SET
         status_pgto = COALESCE($1, status_pgto),
         forma_pgto  = COALESCE($2, forma_pgto)
       WHERE id = $3 RETURNING *`,
      [status_pgto || null, forma_pgto || null, req.params.id]
    );
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao atualizar pagamento' });
  }
});

// DELETE /api/bar/:id
router.delete('/:id', auth, crmOnly, async (req, res) => {
  try {
    // Verifica propriedade antes de excluir
    const { rows: existing } = await pool.query('SELECT est_id FROM bar_vendas WHERE id=$1', [req.params.id]);
    if (!existing.length) return res.status(404).json({ error: 'Venda não encontrada' });
    if (!estAllowed(req, existing[0].est_id)) return res.status(403).json({ error: 'Sem permissão' });

    await pool.query('DELETE FROM bar_vendas WHERE id=$1', [req.params.id]);
    res.json({ message: 'Venda excluída' });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao excluir venda' });
  }
});

module.exports = router;
