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
  if (res.status === 401) {
    // Sessão expirada — limpa credenciais e força reload para a tela de login
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    localStorage.removeItem('userType');
    localStorage.removeItem('token_admin_backup');
    localStorage.removeItem('user_admin_backup');
    window.dispatchEvent(new CustomEvent('crm:session-expired'));
    throw new Error('Sessão expirada. Faça login novamente.');
  }
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
  slots:   (id, date, crm) => get(`/points/${id}/slots?date=${date}${crm ? '&crm=1' : ''}`),
  create:  (data)         => post('/points', data),
  update:  (id, data)     => put(`/points/${id}`, data),
  remove:  (id)           => del(`/points/${id}`),
};

// ── CRM Users ─────────────────────────────────────────────────────
export const userApi = {
  list:    ()          => get('/crm-users'),
  create:  (data)      => post('/crm-users', data),
  update:  (id, data)  => put(`/crm-users/${id}`, data),
  suspend: (id)        => patch(`/crm-users/${id}/suspend`),
  remove:  (id)        => del(`/crm-users/${id}`),
};

// ── Dashboard ─────────────────────────────────────────────────────
export const dashboardApi = {
  get: (params = {}) => get('/dashboard?' + new URLSearchParams(params).toString()),
};

// ── Reservations ──────────────────────────────────────────────────
export const resApi = {
  list:       (params = {})          => get('/reservations?' + new URLSearchParams(params).toString()),
  create:     (data)                 => post('/reservations', data),
  cancel:     (id)                   => patch(`/reservations/${id}/cancel`),
  reschedule: (id, date, s, e, h)    => patch(`/reservations/${id}/reschedule`, { date, start_time: s, end_time: e, hours: h }),
  setStatus:  (id, status)           => patch(`/reservations/${id}`, { status }),
  manualCreate:        (data)          => post('/reservations/manual', data),
  updateParticipantes: (id, parts)     => patch(`/reservations/${id}/participantes`, { participantes: parts }),
  update:              (id, data)       => put(`/reservations/${id}`, data),
  remove:              (id)            => del(`/reservations/${id}`),
};

// ── Auditoria ─────────────────────────────────────────────────────
export const auditApi = {
  list:    (params = {}) => get('/audit?' + new URLSearchParams(params).toString()),
  filters: ()            => get('/audit/filters'),
};

// ── Repasse de professores ────────────────────────────────────────
export const repasseApi = {
  list:    (params = {}) => get('/repasse?' + new URLSearchParams(params).toString()),
  detalhe: (id, params = {}) => get(`/repasse/${id}/detalhe?` + new URLSearchParams(params).toString()),
  marcar:  (body)        => patch('/repasse/marcar', body),
};

// ── Despesas ──────────────────────────────────────────────────────
export const expenseApi = {
  list:   (params = {}) => get('/expenses?' + new URLSearchParams(params).toString()),
  create: (data)        => post('/expenses', data),
  update: (id, data)    => put(`/expenses/${id}`, data),
  remove: (id)          => del(`/expenses/${id}`),
};

// ── Financeiro ────────────────────────────────────────────────────
export const financeApi = {
  cashflow: (params = {}) => get('/finance/cashflow?' + new URLSearchParams(params).toString()),
  projecao: (params = {}) => get('/finance/projecao?' + new URLSearchParams(params).toString()),
};

// ── Funcionários (RH) ─────────────────────────────────────────────
export const employeeApi = {
  list:   (params = {}) => get('/employees?' + new URLSearchParams(params).toString()),
  folha:  (params = {}) => get('/employees/folha?' + new URLSearchParams(params).toString()),
  create: (data)        => post('/employees', data),
  update: (id, data)    => put(`/employees/${id}`, data),
  remove: (id)          => del(`/employees/${id}`),
};

// ── Ponto ─────────────────────────────────────────────────────────
export const pontoApi = {
  list:   (params = {}) => get('/ponto?' + new URLSearchParams(params).toString()),
  save:   (data)        => post('/ponto', data),
  remove: (id)          => del(`/ponto/${id}`),
};

// ── Avaliações ────────────────────────────────────────────────────
export const reviewApi = {
  list:   (type, id)     => get(`/reviews/${type}/${id}`),
  create: (data)         => post('/reviews', data),
};

// ── Produtos / estoque do bar ─────────────────────────────────────
export const barProdutoApi = {
  list:    (estId)       => get(`/bar-produtos${estId ? `?estId=${estId}` : ''}`),
  create:  (data)        => post('/bar-produtos', data),
  update:  (id, data)    => put(`/bar-produtos/${id}`, data),
  estoque: (id, delta)   => patch(`/bar-produtos/${id}/estoque`, { delta }),
  remove:  (id)          => del(`/bar-produtos/${id}`),
};

// ── Relatórios (download .xlsx) ───────────────────────────────────
export async function downloadReport(path, filename) {
  const token = getToken();
  const res = await fetch(`${BASE}${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!res.ok) throw new Error('Falha ao gerar relatório');
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

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

// ── Rankings ──────────────────────────────────────────────────────
export const rankingApi = {
  list:   (params={})  => get('/rankings?' + new URLSearchParams(params).toString()),
  create: (data)       => post('/rankings', data),
  update: (id, data)   => put(`/rankings/${id}`, data),
  remove: (id)         => del(`/rankings/${id}`),
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

// ── Profissionais de Ed. Física ───────────────────────────────────
export const profEfApi = {
  publicList: ()           => get('/profissionais-ef/public'),
  publicGet:  (id)         => get(`/profissionais-ef/${id}/public`),
  list:       ()           => get('/profissionais-ef'),
  create:     (data)       => post('/profissionais-ef', data),
  update:     (id, data)   => put(`/profissionais-ef/${id}`, data),
  remove:     (id)         => del(`/profissionais-ef/${id}`),
};

// ── Impersonation (admin) ─────────────────────────────────────────
export const impersonateApi = {
  listUsers:   ()       => get('/auth/crm-users-list'),
  impersonate: (userId) => post('/auth/impersonate', { userId }),
};

// ── Alunos ────────────────────────────────────────────────────────
export const alunoApi = {
  list:             ()           => get('/alunos'),
  create:           (data)       => post('/alunos', data),
  update:           (id, data)   => put(`/alunos/${id}`, data),
  remove:           (id)         => del(`/alunos/${id}`),
  notificarVencidos:(alunoIds)   => post('/alunos/notificar-vencidos', alunoIds ? { alunoIds } : {}),
};

// ── Reservas Recorrentes ──────────────────────────────────────────
export const recurringApi = {
  list:     ()             => get('/recurring-reservations'),
  create:   (data)         => post('/recurring-reservations', data),
  update:   (id, data)     => patch(`/recurring-reservations/${id}`, data),
  remove:   (id)           => del(`/recurring-reservations/${id}`),
  generate: (id, year, m)  => post(`/recurring-reservations/${id}/generate/${year}/${m}`, {}),
};

// ── Contas a Receber / Resumo por Aluno ───────────────────────────
export const contasApi = {
  list:          (params={}) => get('/finance/contas-a-receber?' + new URLSearchParams(params).toString()),
  updatePgto:    (tipo, id, data) => patch(`/finance/contas-a-receber/${tipo}/${id}`, data),
  resumoAluno:   (params={}) => get('/finance/resumo-aluno?' + new URLSearchParams(params).toString()),
  emailAluno:    (data)      => post('/finance/resumo-aluno/email', data),
  whatsappAluno: (data)      => post('/finance/resumo-aluno/whatsapp', data),
  clientesFinanceiros: ()    => get('/finance/clientes'),
};

// ── WhatsApp (Evolution API) ──────────────────────────────────────
export const whatsappApi = {
  status:       ()           => get('/whatsapp/status'),
  qrcode:       ()           => get('/whatsapp/qrcode'),
  disconnect:   ()           => post('/whatsapp/disconnect', {}),
  // Automations
  automations:  (estId)      => get('/whatsapp/automations' + (estId ? `?est_id=${estId}` : '')),
  saveAuto:     (type, data) => req('PUT', `/whatsapp/automations/${type}`, data),
  // Logs
  logs:         ()           => get('/whatsapp/automation-logs'),
  // Alerts
  alert:        ()           => get('/whatsapp/alert'),
  ackAlert:     ()           => post('/whatsapp/alert/ack', {}),
};
// ── Comissão Gerente ──────────────────────────────────────────────
export const comissaoGerenteApi = {
  list:         (params={}) => get('/comissao-gerente?' + new URLSearchParams(params).toString()),
  setPercentual:(id, pct)   => req('PATCH', `/comissao-gerente/${id}/percentual`, { percentual: pct }),
  marcarPago:   (id, ate)   => req('PATCH', `/comissao-gerente/${id}/marcar-pago`, { ate }),
};

// ── Horários Livres ─────────────────────────────────────────────
export const horariosLivresApi = {
  get: (params={}) => get('/horarios-livres?' + new URLSearchParams(params).toString()),
};
