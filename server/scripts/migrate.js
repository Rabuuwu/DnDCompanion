require('dotenv').config({ path: require('node:path').resolve(__dirname, '../../.env') });
const { pool } = require('../src/db');
const { applyMigrations } = require('../src/migrations');

applyMigrations(pool)
  .then(() => pool.end())
  .catch(async (error) => {
    console.error('Migration failed', error.code || 'migration_error');
    await pool.end();
    process.exitCode = 1;
  });
