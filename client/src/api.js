/**
 * Cliente da API — P. Soluções Esportes
 * Todas as chamadas ao backend passam por aqui.
 */

const BASE = '/api';

function getToken() {
  return localStorage.getItem('token');
}

async function req(method, path, body) {
  const token = getToken();
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Erro ${res.status}`);
  return data;
}

const get  = (path)        => req('GET',    path);
const post = (path, body)  => req('POST',   path, body);
const put  = (path, body)  => req('PUT',    path, body);
const patch= (path, body)  => req('PATCH',  path, body);
const del  = (path)        => req('DELETE', path);

// ── Auth ─────────────────────────────────────────────────────────
export const authApi = {
  crmLogin:       (email, password)          => post('/auth/crm/login',      { email, password }),
  pubLogin:       (email, password)          => post('/auth/public/login',   { email, password }),
  pubRegister:    (name, cpf, email, password) => post('/auth/public/register', { name, cpf, email, password }),
  forgotPassword: (email, type)              => post('/auth/forgot-password', { email, type }),
  resetPassword:  (token, password, type)    => post('/auth/reset-password',  { token, password, type }),
  me:             ()                         => get('/auth/me'),
};

// ── Establishments ────────────────────────────────────────────────
export const estApi = {
  list:    ()         => get('/establishments'),
  get:     (id)       => get(`/establishments/${id}`),
  getFull: (id)       => get(`/establishments/${id}/full`),
  create:  (data)     => post('/establishments', data),
  update:  (id, data) => put(`/establishments/${id}`, data),
};

// ── Points ────────────────────────────────────────────────────────
export const pointApi = {
  list:    (estId)        => get(`/points${estId ? `?estId=${estId}` : ''}`),
  get:     (id)           => get(`/points/${id}`),
  slots:   (id, date)     => get(`/points/${id}/slots?date=${date}`),
  create:  (data)         => post('/points', data),
  update:  (id, data)     => put(`/points/${id}`, data),
  remove:  (id)           => del(`/points/${id}`),
};

// ── CRM Users ─────────────────────────────────────────────────────
export const userApi = {
  list:   ()          => get('/crm-users'),
  create: (data)      => post('/crm-users', data),
  update: (id, data)  => put(`/crm-users/${id}`, data),
  remove: (id)        => del(`/crm-users/${id}`),
};

// ── Dashboard ─────────────────────────────────────────────────────
export const dashboardApi = {
  get: () => get('/dashboard'),
};

// ── Reservations ──────────────────────────────────────────────────
export const resApi = {
  list:       (params = {})          => get('/reservations?' + new URLSearchParams(params).toString()),
  create:     (data)                 => post('/reservations', data),
  cancel:     (id)                   => patch(`/reservations/${id}/cancel`),
  reschedule: (id, date, s, e, h)    => patch(`/reservations/${id}/reschedule`, { date, start_time: s, end_time: e, hours: h }),
  setStatus:  (id, status)           => patch(`/reservations/${id}`, { status }),
  manualCreate: (data)               => post('/reservations/manual', data),
};

// ── Token helpers ─────────────────────────────────────────────────
export function saveToken(token) { localStorage.setItem('token', token); }
export function clearToken()     { localStorage.removeItem('token'); }

// ── Professores ───────────────────────────────────────────────────
export const professorApi = {
  list:   (estId)     => get(`/professores${estId ? `?estId=${estId}` : ''}`),
  get:    (id)        => get(`/professores/${id}`),
  create: (data)      => post('/professores', data),
  update: (id, data)  => put(`/professores/${id}`, data),
  remove: (id)        => del(`/professores/${id}`),
};

// ── Planos de Aula ────────────────────────────────────────────────
export const planoApi = {
  list:   (params = {}) => get('/planos?' + new URLSearchParams(params).toString()),
  get:    (id)           => get(`/planos/${id}`),
  create: (data)         => post('/planos', data),
  update: (id, data)     => put(`/planos/${id}`, data),
  remove: (id)           => del(`/planos/${id}`),
};

// ── Bar ───────────────────────────────────────────────────────────
export const barApi = {
  clientes: ()           => get('/bar/clientes'),
  list:     (params={})  => get('/bar?' + new URLSearchParams(params).toString()),
  create:   (data)       => post('/bar', data),
  remove:   (id)         => del(`/bar/${id}`),
};

// ── Manutenção ────────────────────────────────────────────────────
export const manutencaoApi = {
  list:   (params={})  => get('/manutencao?' + new URLSearchParams(params).toString()),
  create: (data)       => post('/manutencao', data),
  remove: (id)         => del(`/manutencao/${id}`),
};

// ── Dashboard cliente ─────────────────────────────────────────────
export const dashClienteApi = {
  get: (nome) => get(`/dashboard/cliente?nome=${encodeURIComponent(nome)}`),
};
