/**
 * WhatsApp Service — wrapper para a Evolution API
 *
 * Variáveis de ambiente necessárias:
 *   EVOLUTION_API_URL  — ex: https://pezzutti-whatsapp.fly.dev
 *   EVOLUTION_API_KEY  — chave de autenticação da Evolution API
 *   EVOLUTION_INSTANCE — nome da instância (default: "pesportes")
 */

const EVOLUTION_URL = (process.env.EVOLUTION_API_URL || '').replace(/\/$/, '');
const EVOLUTION_KEY = process.env.EVOLUTION_API_KEY || '';
const INSTANCE = process.env.EVOLUTION_INSTANCE || 'pesportes';

function headers() {
  return {
    'Content-Type': 'application/json',
    apikey: EVOLUTION_KEY,
  };
}

async function evoFetch(method, path, body) {
  if (!EVOLUTION_URL) throw new Error('EVOLUTION_API_URL não configurado');
  const url = `${EVOLUTION_URL}${path}`;
  const res = await fetch(url, {
    method,
    headers: headers(),
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  if (!res.ok) {
    // Evolution API retorna exists:false quando o número não está no WhatsApp
    const msgArr = data?.response?.message;
    if (Array.isArray(msgArr) && msgArr[0]?.exists === false) {
      throw new Error(`Número ${msgArr[0].number} não está registrado no WhatsApp`);
    }
    const msg = data?.message || data?.error || `Erro ${res.status}`;
    console.error('[evoFetch] Bad response', { method, path, status: res.status, body: JSON.stringify(body), response: text });
    throw new Error(msg);
  }
  return data;
}

/**
 * Retorna o estado de conexão da instância.
 * Possíveis states: "open" | "close" | "connecting"
 */
async function getStatus() {
  try {
    const data = await evoFetch('GET', `/instance/connectionState/${INSTANCE}`);
    const state = data?.instance?.state || data?.state || 'close';
    const connected = state === 'open';

    // Se conectado, busca o número do telefone vinculado
    let phone = null;
    let profileName = null;
    if (connected) {
      try {
        const instances = await evoFetch('GET', `/instance/fetchInstances`);
        const inst = Array.isArray(instances)
          ? instances.find(i => i.instance?.instanceName === INSTANCE || i.name === INSTANCE)
          : null;
        // ownerJid: "5511999999999@s.whatsapp.net"
        const ownerJid = inst?.instance?.ownerJid || inst?.ownerJid || inst?.instance?.profilePictureUrl?.split?.('/')[0] || null;
        if (ownerJid) {
          phone = ownerJid.replace('@s.whatsapp.net', '').replace('@c.us', '');
        }
        profileName = inst?.instance?.profileName || inst?.profileName || null;
      } catch {}
    }

    return { connected, state, instance: INSTANCE, phone, profileName };
  } catch (err) {
    return { connected: false, state: 'close', instance: INSTANCE, error: err.message };
  }
}

/**
 * Garante que a instância existe e retorna o QR code (base64).
 * Se já estiver conectada, retorna connected: true sem QR.
 */
async function getQRCode() {
  // Garante que a instância existe
  try {
    await evoFetch('GET', `/instance/fetchInstances`);
  } catch {}

  // Tenta criar a instância (ignora erro se já existir)
  try {
    await evoFetch('POST', '/instance/create', {
      instanceName: INSTANCE,
      qrcode: true,
      integration: 'WHATSAPP-BAILEYS',
    });
  } catch {}

  // Verifica estado atual
  const status = await getStatus();
  if (status.connected) return { connected: true, instance: INSTANCE };

  // Busca QR code
  const data = await evoFetch('GET', `/instance/connect/${INSTANCE}`);
  const qrcode = data?.base64 || data?.qrcode?.base64 || null;
  return { connected: false, qrcode, instance: INSTANCE };
}

/**
 * Desconecta (logout) a instância.
 */
async function disconnect() {
  await evoFetch('DELETE', `/instance/logout/${INSTANCE}`);
  return { success: true };
}

/**
 * Formata um número de telefone brasileiro para o formato aceito pela Evolution API.
 * Remove não-dígitos, garante DDI 55.
 * Retorna string no formato "5511999999999@s.whatsapp.net"
 */
function formatPhone(raw) {
  let digits = (raw || '').replace(/\D/g, '');
  // Remove DDI se já tiver
  if (digits.startsWith('55') && digits.length > 11) {
    // já tem DDI
  } else if (digits.length === 11 || digits.length === 10) {
    digits = '55' + digits;
  }
  return digits;
}

/**
 * Envia mensagem de texto para um número.
 * @param {string} phone  — número do destinatário (qualquer formato BR)
 * @param {string} text   — mensagem
 */
async function sendText(phone, text) {
  const number = formatPhone(phone);
  if (!number || number.length < 12) throw new Error('Telefone inválido: ' + phone);

  const data = await evoFetch('POST', `/message/sendText/${INSTANCE}`, {
    number,
    text,
  });
  return { success: true, messageId: data?.key?.id || data?.id, number };
}

module.exports = { getStatus, getQRCode, disconnect, sendText, formatPhone, INSTANCE };
