const jwt = require('jsonwebtoken');

/**
 * Middleware de autenticação JWT.
 * Verifica o token no header Authorization: Bearer <token>
 * e popula req.user com { id, role, type: 'crm' | 'public' }
 */
function auth(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token não fornecido' });
  }
  const token = header.slice(7);
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = payload;
    next();
  } catch {
    return res.status(401).json({ error: 'Token inválido ou expirado' });
  }
}

/** Garante que o usuário é do CRM (admin ou manager) */
function crmOnly(req, res, next) {
  if (req.user?.type !== 'crm') {
    return res.status(403).json({ error: 'Acesso restrito ao CRM' });
  }
  next();
}

/** Garante que o usuário é admin */
function adminOnly(req, res, next) {
  if (req.user?.type !== 'crm' || req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'Acesso restrito ao Administrador' });
  }
  next();
}

/** Aceita tanto usuários CRM quanto públicos autenticados */
function anyAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token não fornecido' });
  }
  const token = header.slice(7);
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: 'Token inválido' });
  }
}

/** Admin ou Gerente */
function adminOrManager(req, res, next) {
  if (req.user?.type !== 'crm' || !['admin','manager'].includes(req.user?.role))
    return res.status(403).json({ error: 'Acesso restrito a Administradores e Gerentes' });
  next();
}

/** Qualquer usuário CRM autenticado (admin, manager, simples, profissional) */
function adminManagerOrSimples(req, res, next) {
  if (req.user?.type !== 'crm')
    return res.status(403).json({ error: 'Acesso restrito' });
  next();
}

/** Admin ou Profissional EF autenticado (qualquer profissional logado) */
function profissionalOrAdmin(req, res, next) {
  if (req.user?.type !== 'crm') return res.status(403).json({ error: 'Acesso restrito' });
  if (req.user.role === 'admin' || req.user.profissional_id) return next();
  return res.status(403).json({ error: 'Acesso restrito' });
}

module.exports = { auth, crmOnly, adminOnly, adminOrManager, adminManagerOrSimples, anyAuth, profissionalOrAdmin };
