/**
 * Rotas WhatsApp — /api/whatsapp
 */
const express = require('express');
const router  = express.Router();
const pool    = require('../db/pool');
const { auth, adminOrManager } = require('../middleware/auth');
const wa = require('../services/whatsapp');

// ── Helpers ──────────────────────────────────────────────────────────────────
function getEstIds(user) {
  return Array.from(new Set([
    ...(user.est_ids || []),
    ...(user.est_id ? [user.est_id] : []),
  ])).map(Number).filter(Boolean);
}

function getEstId(user, bodyEstId) {
  if (user.role === 'admin') return Number(bodyEstId) || null;
  return Number(user.est_id) || (user.est_ids && Number(user.est_ids[0])) || null;
}

// ── Conexão ───────────────────────────────────────────────────────────────────
router.get('/status', auth, adminOrManager, async (req, res) => {
  try { res.json(await wa.getStatus()); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/qrcode', auth, adminOrManager, async (req, res) => {
  try { res.json(await wa.getQRCode()); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/disconnect', auth, adminOrManager, async (req, res) => {
  try { res.json(await wa.disconnect()); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Automações ────────────────────────────────────────────────────────────────
const VALID_TYPES = ['cobranca_mensal', 'saldo_pendente', 'aniversario'];

// GET /api/whatsapp/automations?est_id=X
router.get('/automations', auth, adminOrManager, async (req, res) => {
  try {
    const estId = req.user.role === 'admin'
      ? (req.query.est_id || null)
      : getEstId(req.user);
    if (!estId) return res.json([]);

    const { rows } = await pool.query(
      `SELECT * FROM whatsapp_automations WHERE est_id=$1 ORDER BY type`,
      [estId]
    );

    // Return all 3 types, even if not yet in DB (defaults)
    const defaults = {
      cobranca_mensal: { enabled: false, config: { dia_do_mes: 5,  mensagem: 'Olá {nome}! 👋\n\nPassando para avisar que você tem um saldo pendente de *{valor}* no {estabelecimento}.\n\nPor favor, entre em contato para regularizar. 🙏' } },
      saldo_pendente:  { enabled: false, config: { dias: 45, frequencia: 'mensal', mensagem: 'Olá {nome}! 👋\n\nNotamos que você tem um saldo em aberto de *{valor}* há mais de {dias} dias no {estabelecimento}.\n\nPodemos te ajudar a regularizar? Entre em contato! 💚' } },
      aniversario:     { enabled: false, config: { mensagem: '🎉 Feliz Aniversário, {nome}!\n\nToda a equipe do {estabelecimento} deseja um dia incrível! 🎂🎊\n\nVenha nos visitar e aproveite uma surpresa especial! 🎁' } },
    };

    const result = VALID_TYPES.map(type => {
      const existing = rows.find(r => r.type === type);
      return existing || { est_id: estId, type, ...defaults[type], last_run: null };
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/whatsapp/automations/:type
router.put('/automations/:type', auth, adminOrManager, async (req, res) => {
  if (!VALID_TYPES.includes(req.params.type))
    return res.status(400).json({ error: 'Tipo inválido' });

  const estId = getEstId(req.user, req.body.est_id);
  if (!estId) return res.status(400).json({ error: 'est_id obrigatório' });

  const { enabled, config } = req.body;
  try {
    const { rows } = await pool.query(`
      INSERT INTO whatsapp_automations (est_id, type, enabled, config)
      VALUES ($1,$2,$3,$4)
      ON CONFLICT (est_id, type) DO UPDATE
        SET enabled=$3, config=$4, updated_at=NOW()
      RETURNING *
    `, [estId, req.params.type, enabled !== false, JSON.stringify(config || {})]);
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Logs ──────────────────────────────────────────────────────────────────────
// GET /api/whatsapp/automation-logs
router.get('/automation-logs', auth, adminOrManager, async (req, res) => {
  try {
    const estIds = req.user.role === 'admin' ? null : getEstIds(req.user);
    let rows;
    if (estIds && estIds.length) {
      const r = await pool.query(
        `SELECT * FROM whatsapp_automation_logs WHERE est_id=ANY($1) ORDER BY created_at DESC LIMIT 100`,
        [estIds]
      );
      rows = r.rows;
    } else if (req.user.role === 'admin') {
      const r = await pool.query(
        `SELECT * FROM whatsapp_automation_logs ORDER BY created_at DESC LIMIT 200`
      );
      rows = r.rows;
    } else {
      rows = [];
    }
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Alertas ───────────────────────────────────────────────────────────────────
// GET /api/whatsapp/alert — verifica falhas recentes (últimas 48h) não reconhecidas
router.get('/alert', auth, adminOrManager, async (req, res) => {
  try {
    const estIds = req.user.role === 'admin' ? null : getEstIds(req.user);
    let rows;
    if (estIds && estIds.length) {
      const r = await pool.query(
        `SELECT COUNT(*) AS cnt FROM whatsapp_automation_logs
         WHERE est_id=ANY($1) AND status='failed'
           AND created_at > NOW() - INTERVAL '48 hours'
           AND ack_at IS NULL`,
        [estIds]
      );
      rows = r.rows;
    } else if (req.user.role === 'admin') {
      const r = await pool.query(
        `SELECT COUNT(*) AS cnt FROM whatsapp_automation_logs
         WHERE status='failed' AND created_at > NOW() - INTERVAL '48 hours' AND ack_at IS NULL`
      );
      rows = r.rows;
    } else {
      return res.json({ hasAlert: false, count: 0 });
    }
    res.json({ hasAlert: Number(rows[0]?.cnt || 0) > 0, count: Number(rows[0]?.cnt || 0) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/whatsapp/alert/ack — reconhece alertas do usuário
router.post('/alert/ack', auth, adminOrManager, async (req, res) => {
  try {
    const estIds = req.user.role === 'admin' ? null : getEstIds(req.user);
    if (estIds && estIds.length) {
      await pool.query(
        `UPDATE whatsapp_automation_logs SET ack_at=NOW()
         WHERE est_id=ANY($1) AND status='failed' AND ack_at IS NULL`,
        [estIds]
      );
    } else if (req.user.role === 'admin') {
      await pool.query(
        `UPDATE whatsapp_automation_logs SET ack_at=NOW() WHERE status='failed' AND ack_at IS NULL`
      );
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
