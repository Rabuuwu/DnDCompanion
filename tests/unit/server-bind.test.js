import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { getServerBindOptions } = require('../../server/src/server-bind.js');

test('Render binds the assigned port on all network interfaces', () => {
  assert.deepEqual(getServerBindOptions({ RENDER: 'true', PORT: '10000' }), {
    port: 10000,
    host: '0.0.0.0',
  });
});

test('production binds publicly even without the Render marker', () => {
  assert.deepEqual(getServerBindOptions({ NODE_ENV: 'production', PORT: '4321' }), {
    port: 4321,
    host: '0.0.0.0',
  });
});

test('development stays on loopback by default', () => {
  assert.deepEqual(getServerBindOptions({}), { port: 3000, host: '127.0.0.1' });
});

test('an explicitly configured host is preserved', () => {
  assert.deepEqual(getServerBindOptions({ RENDER: 'true', PORT: '10000', HOST: '127.0.0.1' }), {
    port: 10000,
    host: '127.0.0.1',
  });
});
