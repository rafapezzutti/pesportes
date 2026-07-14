const router = require('express').Router();
const bcrypt = require('bcryptjs');
const pool   = require('../db/pool');
const { auth, adminOnly, adminOrManager } = require('../middleware/auth');

// GET /api/crm-users
router.get('/', auth, adminOrManager, async (req, res) => {
  try {
    let rows;
    if (req.user.role === 'admin') {
      // admin vê todos (exceto outros admins da lista)
      const result = await pool.query(`
        SELECT cu.id, cu.name, cu.email, cu.role, cu.est_id,
               COALESCE(cu.est_ids, '{}') AS est_ids,
               e.name AS est_name, cu.created_at,
               COALESCE(cu.ativo, TRUE) AS ativo,
               cu.permissions
        FROM crm_users cu
        LEFT JOIN establishments e ON cu.est_id = e.id
        WHERE cu.role != 'admin'
        ORDER BY cu.name
      `);
      rows = result.rows;
    } else {
      // gerente vê apenas usuários dos seus estabelecimentos
      const ids = Array.from(new Set([
        ...(req.user.est_ids || []),
        ...(req.user.est_id ? [req.user.est_id] : []),
      ])).map(Number).filter(Boolean);
      if (!ids.length) { res.json([]); return; }
      const result = await pool.query(`
        SELECT cu.id, cu.name, cu.email, cu.role, cu.est_id,
               COALESCE(cu.est_ids, '{}') AS est_ids,
               e.name AS est_name, cu.created_at,
               COALESCE(cu.ativo, TRUE) AS ativo,
               cu.permissions
        FROM crm_users cu
        LEFT JOIN establishments e ON cu.est_id = e.id
        WHERE cu.role != 'admin'
          AND (cu.est_id = ANY($1) OR cu.est_ids && $1::integer[])
        ORDER BY cu.name
      `, [ids]);
      rows = result.rows;
    }
    res.json(rows);
  } catch (err) {
    console.error('[GET /crm-users]', err.message);
    res.status(500).json({ error: 'Erro ao listar usuarios' });
  }
});

// POST /api/crm-users
router.post('/', auth, adminOrManager, async (req, res) => {
  const { name, email, password, role, est_id, est_ids, professor_id } = req.body;
  if (!name || !email || !password)
    return res.status(400).json({ error: 'name, email e password obrigatorios' });
  if (password.length < 6)
    return res.status(400).json({ error: 'Senha minima: 6 caracteres' });

  const VALID_ROLES = req.user.role === 'admin'
    ? ['admin', 'manager', 'simples', 'profissional', 'professor', 'recepcao']
    : ['simples', 'professor', 'recepcao'];
  if (!VALID_ROLES.includes(role))
    return res.status(403).json({ error: 'Voce nao tem permissao para criar este tipo de usuario' });

  try {
    const exists = await pool.query('SELECT id FROM crm_users WHERE email=$1', [email.toLowerCase()]);
    if (exists.rows.length) return res.status(409).json({ error: 'Email ja cadastrado' });

    const hash = await bcrypt.hash(password, 10);
    const resolvedEstId  = ['simples','professor','recepcao'].includes(role) ? (est_id || null) : null;
    const resolvedEstIds = role === 'manager' ? (est_ids || []) : [];
    const resolvedProfId = professor_id ? Number(professor_id) : null; // qualquer role pode ter professor_id

    const { rows } = await pool.query(
      `INSERT INTO crm_users (name, email, password_hash, role, est_id, est_ids)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, name, email, role, est_id, est_ids`,
      [name, email.toLowerCase(), hash, role, resolvedEstId, resolvedEstIds]
    );
    const created = rows[0];
    // link professor_id se fornecido
    if (resolvedProfId) {
      await pool.query(
        `UPDATE crm_users SET professor_id=$1 WHERE id=$2`,
        [resolvedProfId, created.id]
      ).catch(() => {});
    }
    res.status(201).json(created);
  } catch (err) {
    console.error('[POST /crm-users]', err.message);
    res.status(500).json({ error: 'Erro ao criar usuario: ' + err.message });
  }
});

// PUT /api/crm-users/:id
router.put('/:id', auth, adminOnly, async (req, res) => {
  const { name, email, password, role, est_id, est_ids, professor_id } = req.body;
  const VALID_ROLES = ['admin', 'manager', 'simples', 'profissional', 'professor', 'recepcao'];
  if (!VALID_ROLES.includes(role))
    return res.status(400).json({ error: 'Role invalido' });

  try {
    const resolvedEstId  = ['simples','professor','recepcao'].includes(role) ? (est_id || null) : null;
    const resolvedEstIds = role === 'manager' ? (est_ids || []) : [];
    const resolvedProfId = professor_id ? Number(professor_id) : null; // qualquer role pode ter professor_id

    let query, params;
    if (password) {
      if (password.length < 6)
        return res.status(400).json({ error: 'Senha minima: 6 caracteres' });
      const hash = await bcrypt.hash(password, 10);
      query  = `UPDATE crm_users SET name=$1, email=$2, password_hash=$3, role=$4, est_id=$5, est_ids=$6, professor_id=$7
                WHERE id=$8 RETURNING id, name, email, role, est_id, est_ids, professor_id`;
      params = [name, email.toLowerCase(), hash, role, resolvedEstId, resolvedEstIds, resolvedProfId, req.params.id];
    } else {
      query  = `UPDATE crm_users SET name=$1, email=$2, role=$3, est_id=$4, est_ids=$5, professor_id=$6
                WHERE id=$7 RETURNING id, name, email, role, est_id, est_ids, professor_id`;
      params = [name, email.toLowerCase(), role, resolvedEstId, resolvedEstIds, resolvedProfId, req.params.id];
    }
    const { rows } = await pool.query(query, params);
    if (!rows.length) return res.status(404).json({ error: 'Usuario nao encontrado' });
    res.json(rows[0]);
  } catch (err) {
    console.error('[PUT /crm-users]', err.message);
    res.status(500).json({ error: 'Erro ao atualizar usuario: ' + err.message });
  }
});

// PATCH /api/crm-users/:id/suspend  — toggle ativo
router.patch('/:id/suspend', auth, adminOnly, async (req, res) => {
  try {
    if (Number(req.params.id) === req.user.id)
      return res.status(400).json({ error: 'Voce nao pode suspender sua propria conta' });
    const { rows } = await pool.query(
      `UPDATE crm_users SET ativo = NOT COALESCE(ativo, TRUE)
       WHERE id=$1 RETURNING id, ativo`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Usuario nao encontrado' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao suspender usuario' });
  }
});

// DELETE /api/crm-users/:id
router.delete('/:id', auth, adminOnly, async (req, res) => {
  try {
    if (Number(req.params.id) === req.user.id)
      return res.status(400).json({ error: 'Voce nao pode excluir sua propria conta' });
    await pool.query('DELETE FROM crm_users WHERE id=$1', [req.params.id]);
    res.json({ message: 'Usuario excluido' });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao excluir usuario' });
  }
});

// PUT /api/crm-users/:id/permissions — admin ou manager atualiza perfil de permissões
router.put('/:id/permissions', auth, adminOrManager, async (req, res) => {
  const { permissions } = req.body;
  if (!permissions || typeof permissions !== 'object')
    return res.status(400).json({ error: 'permissions deve ser um objeto' });
  try {
    const { rows } = await pool.query(
      `UPDATE crm_users SET permissions = $1 WHERE id = $2
       RETURNING id, name, role, permissions`,
      [JSON.stringify(permissions), req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Usuário não encontrado' });
    res.json(rows[0]);
  } catch (err) {
    console.error('[PUT /crm-users/:id/permissions]', err.message);
    res.status(500).json({ error: 'Erro ao atualizar permissões' });
  }
});


module.exports = router;
