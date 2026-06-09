# Guia de Deploy — P. Soluções Esportes & Reservas
**Domínio:** pesportes.ia.br  
**Stack:** Node.js + PostgreSQL (Neon) + Render

---

## Visão Geral

```
GitHub repo ──push──▶ Render (build + host)
                           │
                      /api ▼
                      Neon PostgreSQL
                           │
              Render ──serve──▶ pesportes.ia.br
```

Tempo estimado: **~30 minutos**

---

## Passo 1 — Preparar o repositório no GitHub

1. Acesse [github.com](https://github.com) e crie um repositório novo, por exemplo `pesportes`.
2. No terminal, dentro da pasta `pesportes-app/`, execute:

```bash
git init
git add .
git commit -m "chore: projeto inicial pesportes"
git remote add origin https://github.com/SEU_USUARIO/pesportes.git
git push -u origin main
```

> O arquivo `.gitignore` já exclui `node_modules/`, `client/dist/` e `.env`.

---

## Passo 2 — Criar o banco de dados no Neon

1. Acesse [console.neon.tech](https://console.neon.tech) e faça login.
2. Clique em **New project** → nomeie como `pesportes` → escolha a região mais próxima (ex: US East).
3. Após a criação, vá em **Connection Details**:
   - Selecione **Pooled connection**
   - Copie a **Connection String** (começa com `postgresql://...`)
4. Guarde essa string; você vai precisar dela no Passo 3.

### Rodar o schema e seed

Você pode rodar os scripts diretamente pelo terminal com a connection string do Neon:

```bash
# 1. Criar as tabelas
DATABASE_URL="postgresql://..." node -e "
const {Pool}=require('pg');
const fs=require('fs');
const p=new Pool({connectionString:process.env.DATABASE_URL,ssl:{rejectUnauthorized:false}});
p.query(fs.readFileSync('db/schema.sql','utf8')).then(()=>{console.log('Schema OK');p.end()});
"

# 2. Criar o usuário admin inicial
DATABASE_URL="postgresql://..." ADMIN_EMAIL="admin@pesportes.ia.br" ADMIN_PASSWORD="Admin@2025!" node db/seed.js
```

Ou, mais fácil: configure o serviço no Render primeiro (Passo 3), então use o botão **Shell** do Render para rodar `node db/seed.js`.

---

## Passo 3 — Criar o serviço no Render

1. Acesse [render.com](https://render.com) e faça login.
2. Clique em **New +** → **Web Service**.
3. Conecte ao repositório GitHub `pesportes` que você criou no Passo 1.
4. Configure:

| Campo | Valor |
|---|---|
| Name | `pesportes` |
| Runtime | `Node` |
| Build Command | `npm install && npm run build` |
| Start Command | `npm start` |
| Instance Type | Free (ou Starter para produção) |

5. Em **Environment Variables**, adicione:

| Chave | Valor |
|---|---|
| `DATABASE_URL` | Connection string do Neon (Passo 2) |
| `JWT_SECRET` | Clique em "Generate" ou cole um segredo longo |
| `GMAIL_USER` | seu_email@gmail.com |
| `GMAIL_PASS` | Senha de app de 16 dígitos (ver abaixo) |
| `ADMIN_EMAIL` | admin@pesportes.ia.br |
| `ADMIN_PASSWORD` | Senha forte para o admin |
| `FRONTEND_URL` | https://pesportes.ia.br |
| `NODE_ENV` | production |

6. Clique em **Create Web Service**. O Render vai fazer o build automaticamente.
7. Aguarde o deploy terminar (≈3–5 min). Você verá o status **Live** e uma URL temporária como `https://pesportes.onrender.com`.

### Configurar Gmail para envio de e-mails

1. Acesse sua conta Google → **Segurança** → **Verificação em duas etapas** (ative se não estiver).
2. Em **Senhas de app** ([myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords)):
   - Selecione aplicativo: **Outro (nome personalizado)** → "pesportes"
   - Clique em **Gerar**
   - Copie os 16 caracteres gerados → cole em `GMAIL_PASS` (sem espaços)

> Se não quiser configurar e-mail agora, o sistema funciona normalmente sem ele — os e-mails serão apenas logados no console do servidor.

---

## Passo 4 — Rodar o seed no Render

Após o deploy estar **Live**:

1. No painel do Render, acesse seu serviço → aba **Shell**.
2. Execute:

```bash
node db/seed.js
```

Isso cria as tabelas (se ainda não existirem) e o usuário admin com as credenciais configuradas em `ADMIN_EMAIL` / `ADMIN_PASSWORD`.

---

## Passo 5 — Configurar o domínio pesportes.ia.br

### No Render

1. No seu serviço, vá em **Settings** → **Custom Domains**.
2. Clique em **Add Custom Domain** → digite `pesportes.ia.br` → clique em **Save**.
3. O Render vai exibir um valor de **CNAME** ou **A record** (anote).

### No painel do seu registrador de domínio (onde o .ia.br foi registrado)

Adicione um registro DNS apontando para o Render:

**Opção A — CNAME (recomendado se o registrador permitir CNAME na raiz):**
```
Tipo:  CNAME
Nome:  @  (ou pesportes.ia.br)
Valor: pesportes.onrender.com
TTL:   3600
```

**Opção B — A record (se o registrador não aceitar CNAME na raiz):**
```
Tipo:  A
Nome:  @
Valor: [IP exibido pelo Render]
TTL:   3600
```

4. Aguarde a propagação do DNS (pode levar de 5 minutos a 24 horas).
5. O Render provisionará automaticamente um certificado SSL (HTTPS) via Let's Encrypt.

### Verificar

Acesse `https://pesportes.ia.br` no navegador. Você deve ver a página inicial do marketplace.

Para acessar o CRM:
- URL: `https://pesportes.ia.br/crm` (ou clique em "Área Administrativa" no rodapé)
- Login: o e-mail e senha definidos em `ADMIN_EMAIL` / `ADMIN_PASSWORD`

---

## Passo 6 — Deploys futuros

Todo `git push` para a branch `main` dispara um rebuild automático no Render.

```bash
# Fluxo normal de atualização
git add .
git commit -m "feat: nova funcionalidade"
git push origin main
# → Render detecta, faz build e reinicia o serviço automaticamente
```

---

## Troubleshooting

**Deploy falhou no Render**
- Verifique os logs em **Logs** do serviço no painel do Render.
- Erros comuns: `DATABASE_URL` não configurado, porta errada (Render injeta `PORT` automaticamente).

**Banco não conecta**
- Verifique se a connection string inclui `?sslmode=require` ou se o código usa `ssl: { rejectUnauthorized: false }`.
- No Neon, verifique se o projeto não está pausado (plano free pausa após inatividade).

**E-mails não chegam**
- Verifique `GMAIL_USER` e `GMAIL_PASS` nas variáveis de ambiente.
- Confirme que a Senha de app foi gerada (não é a senha normal do Gmail).
- Cheque a pasta de Spam do destinatário.

**DNS não propagou**
- Use [whatsmydns.net](https://whatsmydns.net) para checar a propagação global.
- TTL baixo (300) acelera a propagação.

---

## Resumo de credenciais de acesso

| O quê | Onde |
|---|---|
| CRM Admin | `ADMIN_EMAIL` / `ADMIN_PASSWORD` definidos nas env vars |
| Banco Neon | Console: console.neon.tech |
| Render | Dashboard: dashboard.render.com |
| Domínio | Painel do registrador .ia.br |
