/**
 * Permissões por AÇÃO (o que o usuário pode fazer dentro de uma tela).
 *
 * As permissões de TELA (reservas, alunos, financeiro...) continuam no mesmo
 * campo crm_users.permissions; aqui ficam só as chaves de ação.
 * Valor salvo no usuário (true/false) sobrepõe o padrão do perfil (role).
 * A leitura é feita no banco a cada chamada — mudança na tela Perfis vale na hora,
 * sem precisar sair e entrar de novo.
 */
const pool = require('../db/pool');

const ACTION_KEYS = ['alunos_criar', 'alunos_editar', 'alunos_excluir', 'alunos_cobrar', 'mensalidade_baixa', 'reservas_excluir'];

const all = v => Object.fromEntries(ACTION_KEYS.map(k => [k, v]));

// Padrões por perfil. Só o professor muda em relação ao comportamento anterior.
const ROLE_ACTIONS = {
  admin:        all(true),
  manager:      all(true),
  simples:      all(true),
  professor:    { alunos_criar: true,  alunos_editar: false, alunos_excluir: false, alunos_cobrar: true,  mensalidade_baixa: true,  reservas_excluir: false },
  recepcao:     { alunos_criar: false, alunos_editar: false, alunos_excluir: false, alunos_cobrar: false, mensalidade_baixa: false, reservas_excluir: true  },
  profissional: all(false),
};

function mergeActions(role, permissions) {
  const base = { ...(ROLE_ACTIONS[role] || all(false)) };
  if (permissions && typeof permissions === 'object') {
    for (const k of ACTION_KEYS) if (typeof permissions[k] === 'boolean') base[k] = permissions[k];
  }
  return base;
}

/** Retorna o mapa de ações do usuário logado (lido do banco). */
async function getActions(user) {
  if (!user || user.type !== 'crm') return all(false);
  if (user.role === 'admin') return all(true);
  const { rows } = await pool.query('SELECT role, permissions FROM crm_users WHERE id = $1', [user.id]);
  if (!rows.length) return all(false);
  return mergeActions(rows[0].role, rows[0].permissions);
}

async function can(user, action) {
  return (await getActions(user))[action] === true;
}

/** Middleware: requirePerm('alunos_editar') */
function requirePerm(action) {
  return async (req, res, next) => {
    try {
      if (await can(req.user, action)) return next();
      return res.status(403).json({ error: 'Seu perfil não tem permissão para esta ação' });
    } catch (e) {
      console.error('[requirePerm]', e.message);
      return res.status(500).json({ error: 'Erro ao verificar permissão' });
    }
  };
}

/** Lista de estabelecimentos do usuário (vazia = sem restrição, só admin). */
function userEstIds(user) {
  return Array.from(new Set([
    ...(user.est_ids || []),
    ...(user.est_id ? [user.est_id] : []),
  ])).map(Number).filter(Boolean);
}

module.exports = { ACTION_KEYS, ROLE_ACTIONS, mergeActions, getActions, can, requirePerm, userEstIds };
