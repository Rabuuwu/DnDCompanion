const path = require('node:path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });
const { pool } = require('../src/db');
const { applyMigrations } = require('../src/migrations');

async function start({
  env = process.env,
  migrate = () => applyMigrations(pool),
  listen = () => require('../src/server'),
} = {}) {
  if (env.NODE_ENV === 'production' || env.RENDER === 'true' || env.MIGRATE_ON_START === 'true') {
    await migrate();
  }
  return listen();
}

if (require.main === module) {
  start().catch(async (error) => {
    console.error('API startup aborted: database migrations failed', error.code || 'migration_error');
    await pool.end();
    process.exitCode = 1;
  });
}

module.exports = { start };
