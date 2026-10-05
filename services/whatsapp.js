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
    // Extrai mensagem aninhada — array (ex: ["This name ... is already in use."])
    // ou string (ex: {"response":{"message":"Connection Closed"}})
    const nestedMsg = Array.isArray(msgArr) ? msgArr[0] : msgArr;
    const msg = (typeof nestedMsg === 'string' ? nestedMsg : null)
      || data?.message || data?.error || `Erro ${res.status}`;
    console.error('[evoFetch] Bad response', { method, path, status: res.status, body: JSON.stringify(body), response: text });
    const err = new Error(msg);
    err.status = res.status;
    throw err;
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
 * Reinicia a conexão da instância na Evolution API (sem apagar a sessão).
 * Resolve o caso "instância aparece como open mas o envio dá Connection Closed".
 */
async function restartInstance(instance) {
  instance = instance || INSTANCE_PREFIX;
  try {
    return await evoFetch('POST', `/instance/restart/${instance}`);
  } catch (e) {
    // Versões antigas da Evolution usam PUT
    if (e.status === 404 || e.status === 405) return evoFetch('PUT', `/instance/restart/${instance}`);
    throw e;
  }
}

/** Aguarda a instância ficar "open" (até maxMs). Retorna true/false. */
async function waitOpen(instance, maxMs = 15000) {
  const until = Date.now() + maxMs;
  while (Date.now() < until) {
    await new Promise(r => setTimeout(r, 1500));
    try {
      const data = await evoFetch('GET', `/instance/connectionState/${instance}`);
      if ((data?.instance?.state || data?.state) === 'open') return true;
    } catch {}
  }
  return false;
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
 * Força reconexão: logout → delete → create → QR.
 * Usado quando a instância existe mas está com sessão corrompida.
 */
async function forceReconnect(instance) {
  instance = instance || INSTANCE_PREFIX;
  // 1. logout silencioso
  try { await evoFetch('DELETE', `/instance/logout/${instance}`); } catch {}
  await new Promise(r => setTimeout(r, 1000));
  // 2. delete silencioso
  try { await evoFetch('DELETE', `/instance/delete/${instance}`); } catch {}
  await new Promise(r => setTimeout(r, 2000));
  // 3. recriar — se a instância ainda existir (delete falhou), conecta direto
  try {
    await evoFetch('POST', '/instance/create', {
      instanceName: instance,
      qrcode: true,
      integration: 'WHATSAPP-BAILEYS',
    });
    await new Promise(r => setTimeout(r, 1000));
  } catch (e) {
    // Se o create falhar por qualquer razão, a instância pode ainda existir.
    // Seguimos para connect — no pior caso ele também falhará e o erro chegará ao cliente.
    console.log(`[forceReconnect] create falhou (${e.message}), reiniciando instância existente`);
    try { await restartInstance(instance); } catch (e2) { console.log(`[forceReconnect] restart falhou (${e2.message})`); }
    await new Promise(r => setTimeout(r, 3000));
  }
  // 4. conectar e retornar QR
  const data = await evoFetch('GET', `/instance/connect/${instance}`);
  const qrcode = data?.base64 || data?.qrcode?.base64 || null;
  if (qrcode) return { connected: false, qrcode, instance };
  // Sem QR: a sessão pode ter voltado sozinha após o restart — devolve o estado real
  const status = await getStatus(instance);
  return { connected: status.connected, qrcode: null, instance, state: status.state };
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
// Erros que indicam sessão "zumbi": a Evolution diz open, mas o socket do WhatsApp caiu
const CLOSED_RE = /connection closed|connection lost|connection terminated|not connected|stream errored|timed out/i;
const RESTART_COOLDOWN_MS = 2 * 60 * 1000;
const lastRestart = new Map(); // instance -> timestamp do último restart automático

function disconnectedError(instance, cause) {
  const err = new Error(
    `WhatsApp sem conexão (${cause}). Vá em WhatsApp > Reconectar e leia o QR Code novamente.`
  );
  err.code = 'WA_DISCONNECTED';
  err.instance = instance;
  return err;
}

async function sendText(phone, text, instance) {
  instance = instance || INSTANCE_PREFIX;
  const number = formatPhone(phone);
  if (!number || number.length < 12) throw new Error('Telefone inválido: ' + phone);

  const path = `/message/sendText/${instance}`;
  const payload = { number, text };
  let data;
  try {
    data = await evoFetch('POST', path, payload);
  } catch (err) {
    if (!CLOSED_RE.test(err.message || '')) throw err;

    // Sessão caiu: reinicia a instância (no máx. 1x a cada 2 min) e tenta de novo uma vez
    const now = Date.now();
    if (now - (lastRestart.get(instance) || 0) < RESTART_COOLDOWN_MS) throw disconnectedError(instance, err.message);
    lastRestart.set(instance, now);
    console.warn(`[whatsapp] ${instance}: "${err.message}" — reiniciando instância e tentando novamente`);
    try {
      await restartInstance(instance);
    } catch (e) {
      console.error(`[whatsapp] ${instance}: restart falhou: ${e.message}`);
      throw disconnectedError(instance, err.message);
    }
    const open = await waitOpen(instance);
    if (!open) throw disconnectedError(instance, 'sessão não voltou após reinício');
    await new Promise(r => setTimeout(r, 1500));
    try {
      data = await evoFetch('POST', path, payload);
      lastRestart.delete(instance); // voltou a funcionar — libera novo restart se cair de novo
      console.log(`[whatsapp] ${instance}: reconectado, mensagem enviada`);
    } catch (e2) {
      throw CLOSED_RE.test(e2.message || '') ? disconnectedError(instance, e2.message) : e2;
    }
  }
  return { success: true, messageId: data?.key?.id || data?.id, number };
}

module.exports = { getStatus, getQRCode, forceReconnect, restartInstance, disconnect, sendText, formatPhone, instanceForEst, INSTANCE_PREFIX };
