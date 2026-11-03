import assert from 'node:assert/strict';
import test from 'node:test';
import { loadCommonJs } from '../helpers/load-commonjs.js';

function startup() {
  return loadCommonJs(
    '../../server/scripts/start.js',
    {
      dotenv: { config() {} },
      '../src/db': { pool: {} },
      '../src/migrations': { applyMigrations() {} },
    },
    { __dirname: '/offline/server/scripts' },
  ).start;
}

test('production and Render do not accept requests before migrations finish', async () => {
  for (const env of [{ NODE_ENV: 'production' }, { RENDER: 'true' }, { MIGRATE_ON_START: 'true' }]) {
    const calls = [];
    let finish;
    const pending = startup()({
      env,
      migrate: () =>
        new Promise((resolve) => {
          calls.push('migrate');
          finish = resolve;
        }),
      listen: () => calls.push('listen'),
    });
    assert.deepEqual(calls, ['migrate']);
    finish();
    await pending;
    assert.deepEqual(calls, ['migrate', 'listen']);
  }
});

test('failed migration prevents API startup', async () => {
  await assert.rejects(
    startup()({
      env: { NODE_ENV: 'production' },
      migrate: async () => {
        throw new Error('fixture failure');
      },
      listen: () => assert.fail('started without schema'),
    }),
    /fixture failure/,
  );
});

test('development keeps explicit migration control', async () => {
  let listening = false;
  await startup()({
    env: { NODE_ENV: 'development' },
    migrate: () => assert.fail('unexpected migration'),
    listen: () => {
      listening = true;
    },
  });
  assert.equal(listening, true);
});

test('migration runner serializes schema changes and releases its lock connection', async () => {
  const calls = [];
  const client = {
    async query(sql) {
      calls.push(sql);
      return { rowCount: 0 };
    },
    release(destroy) {
      assert.equal(destroy, true);
      calls.push('released');
    },
  };
  const { applyMigrations } = loadCommonJs(
    '../../server/src/migrations.js',
    {
      'node:fs/promises': {
        async readdir() {
          return ['002.sql', '001.sql', 'ignore.txt'];
        },
        async readFile(file) {
          return file.endsWith('001.sql') ? 'FIRST' : 'SECOND';
        },
      },
    },
    { __dirname: '/offline/server/src', console: { log() {} } },
  );
  await applyMigrations({
    async connect() {
      return client;
    },
  });
  assert.ok(calls[1].includes('pg_advisory_lock'));
  assert.ok(calls.indexOf('FIRST') < calls.indexOf('SECOND'));
  assert.equal(calls.filter((sql) => sql === 'COMMIT').length, 2);
  assert.equal(calls.at(-1), 'released');
});

test('migration errors roll back before releasing the connection', async () => {
  const calls = [];
  const client = {
    async query(sql) {
      calls.push(sql);
      if (sql === 'BROKEN') throw new Error('fixture failure');
      return { rowCount: 0 };
    },
    release() {
      calls.push('released');
    },
  };
  const { applyMigrations } = loadCommonJs(
    '../../server/src/migrations.js',
    {
      'node:fs/promises': {
        async readdir() {
          return ['001.sql'];
        },
        async readFile() {
          return 'BROKEN';
        },
      },
    },
    { __dirname: '/offline/server/src' },
  );
  await assert.rejects(
    applyMigrations({
      async connect() {
        return client;
      },
    }),
    /fixture failure/,
  );
  assert.deepEqual(calls.slice(-2), ['ROLLBACK', 'released']);
});
