const { readdir, readFile } = require('node:fs/promises');
const path = require('node:path');

async function applyMigrations(pool) {
  const client = await pool.connect();
  try {
    // A single connection owns the lock until it is destroyed in finally.
    await client.query("SET statement_timeout = '60s'");
    await client.query("SELECT pg_advisory_lock(hashtext('dndcompanion:migrations'))");
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
    const directory = path.resolve(__dirname, '../migrations');
    const files = (await readdir(directory)).filter((file) => file.endsWith('.sql')).sort();
    for (const file of files) {
      const exists = await client.query('SELECT 1 FROM schema_migrations WHERE version=$1', [file]);
      if (exists.rowCount) continue;
      const sql = await readFile(path.join(directory, file), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations(version) VALUES ($1)', [file]);
        await client.query('COMMIT');
        console.log(`Applied ${file}`);
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }
  } finally {
    client.release(true);
  }
}

module.exports = { applyMigrations };
