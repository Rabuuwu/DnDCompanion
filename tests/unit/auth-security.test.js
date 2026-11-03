import assert from 'node:assert/strict';
import test from 'node:test';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { loadCommonJs } from '../helpers/load-commonjs.js';

const secret = 'unit-test-only-session-secret-'.repeat(4);
const sessionId = '00000000-0000-4000-8000-000000000001';
const oldPassword = 'Legacy-password-123!';
const hash = bcrypt.hashSync(oldPassword, 4);

function harness() {
  let active = true;
  const calls = [];
  const client = {
    async query(sql) {
      calls.push(sql);
      if (sql.includes('UPDATE auth_sessions')) active = false;
      if (sql.includes('SELECT password_hash')) return { rows: [{ password_hash: hash }], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    },
    release() {},
  };
  const auth = loadCommonJs(
    '../../server/src/auth.js',
    {
      './db': {
        pool: {
          ...client,
          async connect() {
            return client;
          },
        },
      },
      './sessions': {
        async isSessionActive() {
          return active;
        },
      },
      bcryptjs: { ...bcrypt, hashSync: () => hash, hash: (value) => bcrypt.hash(value, 4) },
    },
    { process: { env: { JWT_SECRET: secret } } },
  );
  const token = (claims = {}) =>
    jwt.sign({ sub: '123', sid: sessionId, ...claims }, secret, {
      algorithm: 'HS256',
      issuer: 'dnd-api',
      audience: 'dnd-mobile',
      expiresIn: '15m',
    });
  return { auth, token, calls };
}

function response() {
  return {
    statusCode: 200,
    payload: null,
    status(value) {
      this.statusCode = value;
      return this;
    },
    json(value) {
      this.payload = value;
      return this;
    },
    set() {},
    end() {},
  };
}

test('logout rejects an already issued access token', async () => {
  const { auth, token } = harness();
  const req = { headers: { authorization: `Bearer ${token()}` } };
  let passed = false;
  await auth.requireAuth(req, response(), () => {
    passed = true;
  });
  assert.equal(passed, true);
  assert.equal(req.auth.sessionId, sessionId);
  await auth.logout({ body: { refreshToken: 'fixture-token' } }, response());
  const rejected = response();
  await auth.requireAuth(req, rejected, () => assert.fail('revoked token accepted'));
  assert.equal(rejected.statusCode, 401);
});

test('password change invalidates an existing access token', async () => {
  const { auth, token } = harness();
  const value = token();
  const changed = response();
  await auth.changePassword(
    { user: { id: 123 }, body: { currentPassword: oldPassword, newPassword: 'New-password-456!' } },
    changed,
  );
  assert.equal(changed.statusCode, 204);
  const rejected = response();
  await auth.requireAuth({ headers: { authorization: `Bearer ${value}` } }, rejected, () =>
    assert.fail('old token accepted'),
  );
  assert.equal(rejected.statusCode, 401);
});

test('legacy JWTs without a session identity and invalid subjects are rejected', async () => {
  const { auth, token } = harness();
  for (const claims of [{ sid: undefined }, { sid: 'invalid' }, { sub: 'NaN' }, { sub: '-1' }]) {
    const res = response();
    await auth.requireAuth({ headers: { authorization: `Bearer ${token(claims)}` } }, res, () =>
      assert.fail('invalid token accepted'),
    );
    assert.equal(res.statusCode, 401);
  }
});

test('registration and password changes reject more than 72 UTF-8 bytes before accessing the database', async () => {
  const { auth, calls } = harness();
  for (const password of ['a'.repeat(73), 'ą'.repeat(37)]) {
    const res = response();
    await auth.register({ body: { username: 'fixture_user', password } }, res);
    assert.equal(res.statusCode, 400);
    const changed = response();
    await auth.changePassword(
      { user: { id: 123 }, body: { currentPassword: oldPassword, newPassword: password } },
      changed,
    );
    assert.equal(changed.statusCode, 400);
  }
  assert.equal(calls.length, 0);
});

test('72-byte Unicode password is accepted for a password change', async () => {
  const { auth } = harness();
  const res = response();
  await auth.changePassword(
    { user: { id: 123 }, body: { currentPassword: oldPassword, newPassword: 'ą'.repeat(36) } },
    res,
  );
  assert.equal(res.statusCode, 204);
});
