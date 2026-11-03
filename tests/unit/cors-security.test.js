import assert from 'node:assert/strict';
import test from 'node:test';
import cors from 'cors';
import { corsOptions } from '../../server/src/cors-options.js';

test('real CORS middleware exposes pagination to an allowed browser origin', () => {
  const headers = new Map();
  const res = {
    setHeader: (key, value) => headers.set(key.toLowerCase(), value),
    getHeader: (key) => headers.get(key.toLowerCase()),
  };
  let passed = false;
  cors(corsOptions('https://web.example.test'))(
    { method: 'GET', headers: { origin: 'https://web.example.test' } },
    res,
    (error) => {
      assert.ifError(error);
      passed = true;
    },
  );
  assert.equal(passed, true);
  assert.equal(headers.get('access-control-allow-origin'), 'https://web.example.test');
  for (const name of ['X-Has-More', 'X-Next-Offset', 'X-Next-Cursor']) {
    assert.ok(headers.get('access-control-expose-headers').split(',').includes(name));
  }
});

test('untrusted origins are still rejected', () => {
  corsOptions().origin('https://attacker.example.test', (error) => assert.equal(error.message, 'origin_not_allowed'));
});
