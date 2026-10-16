/**
 * Suspensão de estabelecimento.
 * Estabelecimento suspenso: some do site, não recebe reservas, não manda WhatsApp,
 * e os usuários do CRM dele não conseguem entrar. Os dados ficam guardados.
 *
 * A lista de suspensos fica em cache por 30s (é consultada em toda requisição).
 */
const pool = require('../db/pool');

let cache = { ids: new Set(), at: 0 };

async function suspensos() {
  if (Date.now() - cache.at < 30_000) return cache.ids;
  try {
    const { rows } = await pool.query('SELECT id FROM establishments WHERE suspenso IS TRUE');
    cache = { ids: new Set(rows.map(r => Number(r.id))), at: Date.now() };
  } catch {
    cache.at = Date.now(); // coluna ainda não criada (antes da migração) → ninguém suspenso
  }
  return cache.ids;
}

function invalidar() { cache.at = 0; }

function estsDoUsuario(user) {
  return Array.from(new Set([...(user.est_ids || []), ...(user.est_id ? [user.est_id] : [])]))
    .map(Number).filter(Boolean);
}

async function estSuspenso(estId) {
  return (await suspensos()).has(Number(estId));
}

/** Usuário do CRM bloqueado = todos os estabelecimentos dele estão suspensos. Admin nunca. */
async function usuarioBloqueado(user) {
  if (!user || user.type !== 'crm' || user.role === 'admin' || user.impersonated_by) return false;
  const ids = estsDoUsuario(user);
  if (!ids.length) return false;
  const s = await suspensos();
  return ids.every(id => s.has(id));
}

const MSG_BLOQUEIO = 'O acesso deste estabelecimento está suspenso. Fale com a P. Soluções.';

module.exports = { suspensos, invalidar, estSuspenso, usuarioBloqueado, MSG_BLOQUEIO };
