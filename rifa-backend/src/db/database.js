const { Pool } = require('pg');
const fs       = require('fs');
const path     = require('path');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production'
    ? { rejectUnauthorized: false }
    : false,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 15000, // Neon (free tier) pode levar alguns segundos pra "acordar" depois de ficar ocioso
});

// Conecta e roda a migration com retry, em vez de derrubar o processo na
// primeira falha. Evita o crash-loop quando o Neon está hibernado/lento
// pra responder logo após o deploy.
async function iniciar(tentativa = 1) {
  const MAX_TENTATIVAS = 8;
  const ESPERA_MS = 5000;

  try {
    await pool.query('SELECT 1'); // força a primeira conexão real
    console.log('✅ PostgreSQL conectado');

    const sql = fs.readFileSync(path.join(__dirname, 'schema.pg.sql'), 'utf-8');
    await pool.query(sql);
    console.log('✅ Schema aplicado');

  } catch (err) {
    console.error(`❌ Erro ao conectar/migrar no PostgreSQL (tentativa ${tentativa}/${MAX_TENTATIVAS}):`, err.message);

    if (tentativa >= MAX_TENTATIVAS) {
      console.error('❌ Esgotadas as tentativas de conexão com o banco. Encerrando.');
      process.exit(1);
    }

    setTimeout(() => iniciar(tentativa + 1), ESPERA_MS);
  }
}

iniciar();

async function query(sql, params = []) {
  const r = await pool.query(sql, params);
  return r.rows;
}

async function queryOne(sql, params = []) {
  const r = await pool.query(sql, params);
  return r.rows[0];
}

async function execute(sql, params = []) {
  const r = await pool.query(sql, params);
  return r.rowCount;
}

async function transaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { query, queryOne, execute, transaction };
