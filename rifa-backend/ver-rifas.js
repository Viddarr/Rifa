// arquivo: ver-rifas.js
const { Pool } = require('pg');
const pool = new Pool({
  connectionString: 'postgresql://postgres:emasMxvbdWBPRDnCmmrjGvFgFFvstLHG@hopper.proxy.rlwy.net:21226/railway',
  ssl: { rejectUnauthorized: false },
});
pool.query('SELECT id, titulo, status FROM rifas')
  .then(r => console.log(r.rows))
  .finally(() => pool.end());