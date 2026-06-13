const { Pool, neonConfig } = require('@neondatabase/serverless');
const ws = require('ws');

// Driver serverless: WebSocket em vez de TCP persistente.
// Conexões fecham em 5s de idle → Neon escala a zero logo após a última query real.
neonConfig.webSocketConstructor = ws;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 5,
  idleTimeoutMillis: 5000,
  connectionTimeoutMillis: 5000,
});

pool.on('error', (err) => {
  console.error('Erro inesperado no pool do PostgreSQL:', err);
});

module.exports = pool;
