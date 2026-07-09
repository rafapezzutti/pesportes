/**
 * WhatsApp Service — wrapper para a Evolution API
 *
 * Variáveis de ambiente necessárias:
 *   EVOLUTION_API_URL  — ex: https://pezzutti-whatsapp.fly.dev
 *   EVOLUTION_API_KEY  — chave de autenticação da Evolution API
 *   EVOLUTION_INSTANCE — prefixo das instâncias (default: "pesportes")
 *
 * Cada estabelecimento usa instância: pesportes_{est_id}
 */

const EVOLUTION_URL = (process.env.EVOLUTION_API_URL || '').replace(/\/$/, '');
const EVOLUTION_KEY = process.env.EVOLUTION_API_KEY || '';
const INSTANCE_PREFIX = process.env.EVOLUTION_INSTANCE || 'pesportes';

/** Retorna o nome da instância para um estabelecimento */
function instanceForEst(estId) {
  return estId ? `${INSTANCE_PREFIX}_${estId}` : INSTANCE_PREFIX;
}

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
 * Retorna o estado de conexão da instância do estabelecimento.
 */
async function getStatus(instance) {
  instance = instance || INSTANCE_PREFIX;
  try {
    const data = await evoFetch('GET', `/instance/connectionState/${instance}`);
    const state = data?.instance?.state || data?.state || 'close';
    const connected = state === 'open';

    let phone = null;
    let profileName = null;
    if (connected) {
      try {
        const instances = await evoFetch('GET', `/instance/fetchInstances`);
        const inst = Array.isArray(instances)
          ? instances.find(i => i.instance?.instanceName === instance || i.name === instance)
          : null;
        const ownerJid = inst?.instance?.ownerJid || inst?.ownerJid || null;
        if (ownerJid) {
          phone = ownerJid.replace('@s.whatsapp.net', '').replace('@c.us', '');
        }
        profileName = inst?.instance?.profileName || inst?.profileName || null;
      } catch {}
    }

    return { connected, state, instance, phone, profileName };
  } catch (err) {
    return { connected: false, state: 'close', instance, error: err.message };
  }
}

/**
 * Garante que a instância existe e retorna o QR code (base64).
 */
async function getQRCode(instance) {
  instance = instance || INSTANCE_PREFIX;

  // Tenta criar a instância (ignora erro se já existir)
  try {
    await evoFetch('POST', '/instance/create', {
      instanceName: instance,
      qrcode: true,
      integration: 'WHATSAPP-BAILEYS',
    });
  } catch {}

  // Verifica estado atual
  const status = await getStatus(instance);
  if (status.connected) return { connected: true, instance };

  // Busca QR code
  const data = await evoFetch('GET', `/instance/connect/${instance}`);
  const qrcode = data?.base64 || data?.qrcode?.base64 || null;
  return { connected: false, qrcode, instance };
}

/**
 * Desconecta (logout) a instância.
 */
async function disconnect(instance) {
  instance = instance || INSTANCE_PREFIX;
  await evoFetch('DELETE', `/instance/logout/${instance}`);
  return { success: true };
}

/**
 * Formata um número de telefone brasileiro para o formato aceito pela Evolution API.
 */
function formatPhone(raw) {
  let digits = (raw || '').replace(/\D/g, '');
  if (digits.startsWith('55') && digits.length > 11) {
    // já tem DDI
  } else if (digits.length === 11 || digits.length === 10) {
    digits = '55' + digits;
  }
  return digits;
}

/**
 * Envia mensagem de texto para um número, usando a instância do estabelecimento.
 * @param {string} phone    — número do destinatário
 * @param {string} text     — mensagem
 * @param {string} instance — instância da Evolution API (usa instanceForEst)
 */
async function sendText(phone, text, instance) {
  instance = instance || INSTANCE_PREFIX;
  const number = formatPhone(phone);
  if (!number || number.length < 12) throw new Error('Telefone inválido: ' + phone);

  const data = await evoFetch('POST', `/message/sendText/${instance}`, {
    number,
    text,
  });
  return { success: true, messageId: data?.key?.id || data?.id, number };
}

module.exports = { getStatus, getQRCode, disconnect, sendText, formatPhone, instanceForEst, INSTANCE_PREFIX };
