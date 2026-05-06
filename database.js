// ══════════════════════════════════════════════════════════════════════
// database.js — Conexão PostgreSQL
// ══════════════════════════════════════════════════════════════════════

const { Pool } = require('pg');
const fs       = require('fs');
const path     = require('path');

// ── Pool de conexões ───────────────────────────────────────────────────
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production'
    ? { rejectUnauthorized: false }   // necessário no Railway
    : false,                          // sem SSL em desenvolvimento local
  max:               10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

// ── Testa a conexão ao iniciar ─────────────────────────────────────────
pool.connect((err, client, release) => {
  if (err) {
    console.error('❌ Erro ao conectar no PostgreSQL:', err.message);
    console.error('Verifique a variável DATABASE_URL no seu .env');
    process.exit(1);
  }
  release();
  console.log('✅ PostgreSQL conectado');
});

// ── Helpers de query ───────────────────────────────────────────────────

/**
 * Retorna todas as linhas
 * Exemplo: query('SELECT * FROM rifas WHERE status = $1', ['ativa'])
 */
async function query(sql, params = []) {
  const result = await pool.query(sql, params);
  return result.rows;
}

/**
 * Retorna só a primeira linha (ou undefined)
 * Exemplo: queryOne('SELECT * FROM rifas WHERE id = $1', [1])
 */
async function queryOne(sql, params = []) {
  const result = await pool.query(sql, params);
  return result.rows[0];
}

/**
 * Para INSERT / UPDATE / DELETE — retorna quantas linhas foram afetadas
 * Exemplo: execute('UPDATE pedidos SET status = $1 WHERE id = $2', ['pago', 5])
 */
async function execute(sql, params = []) {
  const result = await pool.query(sql, params);
  return result.rowCount;
}

/**
 * Executa múltiplas queries em bloco atômico
 * Se qualquer uma falhar, TUDO volta atrás (ROLLBACK automático)
 *
 * Uso:
 *   await transaction(async (client) => {
 *     await client.query('INSERT INTO pedidos ...', [...]);
 *     await client.query('INSERT INTO bilhetes ...', [...]);
 *   });
 */
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

// ── Aplica o schema na primeira execução ──────────────────────────────
async function migrate() {
  try {
    const schemaPath = path.join(__dirname, 'schema.pg.sql');
    const schema     = fs.readFileSync(schemaPath, 'utf-8');
    await pool.query(schema);
    console.log('✅ Schema aplicado');
  } catch (err) {
    console.error('❌ Erro ao aplicar schema:', err.message);
    process.exit(1);
  }
}

migrate();

module.exports = { query, queryOne, execute, transaction };
