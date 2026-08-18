require('dotenv').config({ path: require('node:path').resolve(__dirname, '../../.env') });

const assert = require('node:assert/strict');
const { readdir, readFile } = require('node:fs/promises');
const path = require('node:path');
const { Client } = require('pg');

const schema = `migration_test_${Date.now()}_${Math.floor(Math.random() * 1_000_000)}`;
const quotedSchema = `"${schema}"`;

async function run() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: true } : false,
  });
  await client.connect();
  try {
    await client.query(`CREATE SCHEMA ${quotedSchema}`);
    await client.query(`SET search_path TO ${quotedSchema}`);
    const migrationsDir = path.resolve(__dirname, '../migrations');
    const files = (await readdir(migrationsDir)).filter((file) => file.endsWith('.sql')).sort();
    for (const file of files) {
      await client.query('BEGIN');
      try {
        await client.query(await readFile(path.join(migrationsDir, file), 'utf8'));
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        error.message = `${file}: ${error.message}`;
        throw error;
      }
    }
    const requiredTables = [
      'users',
      'characters',
      'campaigns',
      'dm_notes',
      'campaign_sessions',
      'campaign_npcs',
      'campaign_locations',
      'campaign_factions',
      'campaign_quests',
      'campaign_story_threads',
      'campaign_secrets',
      'campaign_materials',
      'campaign_timeline_events',
      'campaign_content_notifications',
      'quest_party_notes',
    ];
    const result = await client.query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema=$1 AND table_name=ANY($2::text[])`,
      [schema, requiredTables],
    );
    assert.equal(result.rows.length, requiredTables.length);
    console.log(`Migration test passed (${files.length} files, ${requiredTables.length} required tables)`);
  } finally {
    await client.query('RESET search_path').catch(() => {});
    await client.query(`DROP SCHEMA IF EXISTS ${quotedSchema} CASCADE`).catch(() => {});
    await client.end();
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
