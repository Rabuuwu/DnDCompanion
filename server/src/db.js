const { Pool } = require('pg');

const useSsl = process.env.DATABASE_SSL === 'true';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  connectionTimeoutMillis: 5000,
  statement_timeout: 10000,
  idle_in_transaction_session_timeout: 10000,
  ssl: useSsl ? { rejectUnauthorized: true } : false,
});

pool.on('error', (error) => {
  console.error('Unexpected PostgreSQL pool error', error);
});

async function checkDatabase() {
  const result = await pool.query('SELECT NOW() AS server_time');
  return result.rows[0];
}

module.exports = {
  pool,
  checkDatabase,
};
