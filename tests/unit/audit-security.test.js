import assert from 'node:assert/strict';
import test from 'node:test';
import { loadCommonJs } from '../helpers/load-commonjs.js';

test('audit writes cannot create an unbounded database queue', async () => {
  let calls = 0;
  const pending = [];
  const { writeAuditLog } = loadCommonJs('../../server/src/audit.js', {
    './db': {
      pool: {
        query() {
          calls += 1;
          return new Promise((resolve) => pending.push(resolve));
        },
      },
    },
  });
  const writes = Array.from({ length: 100 }, () => writeAuditLog({ action: 'fixture', actorUserId: 123 }));
  assert.equal(calls, 4);
  for (const resolve of pending) resolve({ rows: [] });
  await Promise.all(writes);
});

test('anonymous audit flooding preserves capacity for authenticated events', async () => {
  let calls = 0;
  const { writeAuditLog } = loadCommonJs('../../server/src/audit.js', {
    './db': {
      pool: {
        async query() {
          calls += 1;
        },
      },
    },
  });
  for (let index = 0; index < 200; index += 1) await writeAuditLog({ action: 'anonymous' });
  assert.equal(calls, 100);
  await writeAuditLog({ action: 'change_password', actorUserId: 123 });
  assert.equal(calls, 101);
});
