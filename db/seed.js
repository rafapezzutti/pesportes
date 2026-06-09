/**
 * Seed inicial: cria o usuário Admin no banco.
 * Execute: node db/seed.js
 */
require('dotenv').config();
const bcrypt = require('bcryptjs');
const pool = require('./pool');

const DEFAULT_HOURS = {
  seg: { open: true,  start: '08:00', end: '22:00' },
  ter: { open: true,  start: '08:00', end: '22:00' },
  qua: { open: true,  start: '08:00', end: '22:00' },
  qui: { open: true,  start: '08:00', end: '22:00' },
  sex: { open: true,  start: '08:00', end: '22:00' },
  sab: { open: true,  start: '09:00', end: '20:00' },
  dom: { open: false, start: '09:00', end: '18:00' },
};

async function seed() {
  const client = await pool.connect();
  try {
    console.log('🌱 Iniciando seed...');

    // Lê o schema e executa
    const fs = require('fs');
    const schema = fs.readFileSync(__dirname + '/schema.sql', 'utf8');
    await client.query(schema);
    console.log('✅ Schema criado/verificado');

    // Admin padrão
    const adminEmail = process.env.ADMIN_EMAIL || 'admin@pesportes.ia.br';
    const adminPass  = process.env.ADMIN_PASSWORD || 'Admin@2025!';
    const hash = await bcrypt.hash(adminPass, 10);

    await client.query(`
      INSERT INTO crm_users (name, email, password_hash, role)
      VALUES ($1, $2, $3, 'admin')
      ON CONFLICT (email) DO NOTHING
    `, ['Administrador', adminEmail, hash]);

    console.log(`✅ Admin criado: ${adminEmail} / ${adminPass}`);
    console.log('🎉 Seed concluído com sucesso!');
  } catch (err) {
    console.error('❌ Erro no seed:', err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

seed();
