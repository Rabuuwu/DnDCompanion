import assert from 'node:assert/strict';
import test from 'node:test';
import { requireTestEnvironment } from '../../server/scripts/test-safety.js';

test('integration safety rejects missing or production NODE_ENV', () => {
  for (const NODE_ENV of [undefined, 'production', 'development']) {
    assert.throws(() => requireTestEnvironment({ NODE_ENV }), /NODE_ENV=test/);
  }
});
test('integration safety rejects implicit, malformed and non-test database targets', () => {
  for (const DATABASE_URL of [
    undefined,
    'invalid',
    'https://localhost/dnd_test',
    'postgres://localhost/production',
    'postgres://localhost/latest',
  ]) {
    assert.throws(() => requireTestEnvironment({ NODE_ENV: 'test', DATABASE_URL }));
  }
});
test('integration safety accepts explicit PostgreSQL test databases', () => {
  for (const DATABASE_URL of [
    'postgresql://localhost/dnd_test',
    'postgres://localhost/test_dnd',
    'postgres://localhost/test',
  ]) {
    assert.doesNotThrow(() => requireTestEnvironment({ NODE_ENV: 'test', DATABASE_URL }));
  }
});
