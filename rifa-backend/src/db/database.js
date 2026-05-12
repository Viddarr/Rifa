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
  connectionTimeoutMillis: 2000,
});

pool.connect((err, client, release) => {
  if (err) {
    console.error('❌ Erro ao conectar no PostgreSQL:', err.message);
    process.exit(1);
  }
  release();
  console.log('✅ PostgreSQL conectado');
});

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

async function migrate() {
  try {
    const sql = fs.readFileSync(path.join(__dirname, 'schema.pg.sql'), 'utf-8');
    await pool.query(sql);
    console.log('✅ Schema aplicado');
  } catch (err) {
    console.error('❌ Erro na migration:', err.message);
    process.exit(1);
  }
}

migrate();

module.exports = { query, queryOne, execute, transaction };
