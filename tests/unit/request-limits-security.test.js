import assert from 'node:assert/strict';
import test from 'node:test';
import { loadCommonJs } from '../helpers/load-commonjs.js';

function harness(env = {}) {
  return loadCommonJs('../../server/src/request-limits.js', {}, { process: { env } });
}

function request(limiter, { userId = 123, ip = '127.0.0.1', method = 'POST' } = {}) {
  return new Promise((resolve, reject) => {
    const headers = new Map();
    const req = {
      user: { id: userId },
      ip,
      method,
      headers: {},
      app: {
        get() {
          return false;
        },
      },
    };
    const res = {
      statusCode: 200,
      setHeader(key, value) {
        headers.set(key.toLowerCase(), value);
      },
      getHeader(key) {
        return headers.get(key.toLowerCase());
      },
      append(key, value) {
        this.setHeader(key, value);
      },
      status(code) {
        this.statusCode = code;
        return this;
      },
      send(body) {
        resolve({ status: this.statusCode, headers, body });
      },
    };
    limiter(req, res, (error) => (error ? reject(error) : resolve({ status: 200, headers })));
  });
}

test('real limiter rejects the 121st mutation and keys accounts independently of IP', async () => {
  const { accountLimiter } = harness();
  for (let index = 0; index < 120; index += 1) {
    assert.equal((await request(accountLimiter, { ip: index % 2 ? '127.0.0.2' : '127.0.0.1' })).status, 200);
  }
  const blocked = await request(accountLimiter);
  assert.equal(blocked.status, 429);
  assert.equal(blocked.body.error, 'too_many_requests');
  assert.ok(blocked.headers.has('retry-after'));
  assert.equal((await request(accountLimiter, { userId: 456 })).status, 200);
  assert.equal((await request(accountLimiter, { method: 'GET' })).status, 200);
});

test('global limiter bounds anonymous requests before database work', async () => {
  const { globalLimiter } = harness();
  for (let index = 0; index < 1200; index += 1) assert.equal((await request(globalLimiter)).status, 200);
  assert.equal((await request(globalLimiter)).status, 429);
});

test('limits cannot be disabled in production and test mode alone does not disable them', () => {
  for (const env of [{ NODE_ENV: 'production', DISABLE_TEST_RATE_LIMITS: 'true' }, { NODE_ENV: 'test' }]) {
    assert.equal(harness(env).skipTestLimits(), false);
  }
  assert.equal(harness({ NODE_ENV: 'test', DISABLE_TEST_RATE_LIMITS: 'true' }).skipTestLimits(), true);
});
