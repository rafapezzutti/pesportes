/**
 * Rotas WhatsApp — /api/whatsapp
 * Requer: auth middleware + role admin ou manager
 */
const express = require('express');
const router = express.Router();
const { auth, adminOrManager } = require('../middleware/auth');
const wa = require('../services/whatsapp');

/**
 * GET /api/whatsapp/status
 * Retorna o estado de conexão da instância WhatsApp.
 */
router.get('/status', auth, adminOrManager, async (req, res) => {
  try {
    const status = await wa.getStatus();
    res.json(status);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/whatsapp/qrcode
 * Inicia a instância e retorna o QR code base64, ou connected:true se já logado.
 */
router.get('/qrcode', auth, adminOrManager, async (req, res) => {
  try {
    const result = await wa.getQRCode();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/whatsapp/disconnect
 * Desconecta (logout) a instância WhatsApp.
 */
router.post('/disconnect', auth, adminOrManager, async (req, res) => {
  try {
    const result = await wa.disconnect();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
