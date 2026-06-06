// Middleware global de auditoria (LGPD) — CRM Esportes
// Registra automaticamente toda requisição de escrita (POST/PUT/PATCH/DELETE)
// em audit_logs, sem precisar alterar as rotas existentes.
const pool = require('../db/pool');

const SKIP = [
  /^\/api\/health/,
  /^\/api\/audit/,
  /^\/api\/auth\/forgot-password/,
  /^\/api\/auth\/reset-password/,
];

const SENSITIVE_KEY = /password|senha|token|secret|authorization|cpf|hash/i;

// Remove senhas/tokens e trunca strings longas (fotos base64 etc.)
function sanitize(value, depth = 0) {
  if (value == null || depth > 3) return undefined;
  if (typeof value === 'string') {
    if (value.startsWith('data:') || value.length > 300) return `[${value.length} caracteres]`;
    return value;
  }
  if (typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.slice(0, 20).map(v => sanitize(v, depth + 1));
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    if (SENSITIVE_KEY.test(k)) { out[k] = '[oculto]'; continue; }
    const s = sanitize(v, depth + 1);
    if (s !== undefined) out[k] = s;
  }
  return out;
}

function actionFor(req, path) {
  if (/\/login$/.test(path)) return 'login';
  switch (req.method) {
    case 'POST':   return 'create';
    case 'PUT':
    case 'PATCH':  return 'update';
    case 'DELETE': return 'delete';
    default:       return req.method.toLowerCase();
  }
}

const entityFrom   = (path) => (path.match(/^\/api\/([a-z0-9_-]+)/i) || [])[1] || null;
const entityIdFrom = (path) => (path.match(/\/(\d+)(?:\/|\?|$)/) || [])[1] || null;

function auditLogger(req, res, next) {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return next();
  const path = req.originalUrl.split('?')[0];
  if (SKIP.some(rx => rx.test(path))) return next();

  let responseId = null;
  const origJson = res.json.bind(res);
  res.json = (body) => {
    if (body && typeof body === 'object' && body.id != null) responseId = String(body.id);
    return origJson(body);
  };

  res.on('finish', () => {
    try {
      const action = actionFor(req, path);
      let details;
      if (action === 'login') {
        details = { email: req.body?.email, success: res.statusCode < 400 };
      } else {
        details = sanitize(req.body);
      }
      let detailsJson = details ? JSON.stringify(details) : null;
      if (detailsJson && detailsJson.length > 5000) detailsJson = JSON.stringify({ note: 'payload muito grande, omitido' });

      const u = req.user || {};
      pool.query(
        `INSERT INTO audit_logs
           (user_id, user_type, user_role, est_id, action, entity, entity_id,
            method, path, status_code, details, ip, user_agent)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [
          u.id ?? null,
          u.type ?? null,
          u.role ?? null,
          u.est_id ?? null,
          action,
          entityFrom(path),
          entityIdFrom(path) || responseId,
          req.method,
          path,
          res.statusCode,
          detailsJson,
          (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.ip,
          (req.headers['user-agent'] || '').slice(0, 250),
        ]
      ).catch(err => console.error('[audit] erro ao gravar log:', err.message));
    } catch (err) {
      console.error('[audit] erro:', err.message);
    }
  });

  next();
}

module.exports = auditLogger;
