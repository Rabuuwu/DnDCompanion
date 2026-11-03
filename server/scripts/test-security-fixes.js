require('./test-safety').requireTestEnvironment();

const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { gzipSync } = require('node:zlib');
const { pool } = require('../src/db');

const apiBase = process.env.API_BASE;
if (!apiBase || !['127.0.0.1', 'localhost', '[::1]'].includes(new URL(apiBase).hostname)) {
  throw new Error('Security regression tests require an explicit loopback API_BASE');
}
const username = `fix_security_${Date.now()}_${process.pid}`;
const legacyUsername = `fix_legacy_${Date.now()}_${process.pid}`;
const password = 'Security-password-123!';
const newPassword = 'Changed-security-password-456!';

async function request(path, session, method = 'GET', body) {
  return fetch(`${apiBase}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Origin: 'https://localhost',
      ...(session ? { Authorization: `Bearer ${session.token}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function session(path, suppliedPassword = password) {
  const response = await request(path, null, 'POST', { username, password: suppliedPassword });
  assert.equal(response.status, path.endsWith('register') ? 201 : 200, await response.clone().text());
  return response.json();
}

async function run() {
  const streamControllers = [];
  try {
    const first = await session('/api/auth/register');
    const second = await session('/api/auth/login');
    const compressed = await fetch(`${apiBase}/api/ui-preferences`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${first.token}`,
        'Content-Type': 'application/json',
        'Content-Encoding': 'gzip',
      },
      body: Buffer.concat([gzipSync(Buffer.from('{}')), Buffer.from([255, 255])]),
    });
    assert.equal(compressed.status, 415);
    assert.equal((await fetch(`${apiBase}/health`)).status, 200);
    assert.notEqual(jwt.decode(first.token).sid, jwt.decode(second.token).sid);
    const cors = await request('/api/characters', first);
    assert.equal(cors.status, 200);
    for (const header of ['X-Has-More', 'X-Next-Offset', 'X-Next-Cursor']) {
      assert.ok(cors.headers.get('Access-Control-Expose-Headers').split(',').includes(header));
    }
    const readers = [];
    for (let index = 0; index < 3; index += 1) {
      const controller = new AbortController();
      streamControllers.push(controller);
      const stream = await fetch(`${apiBase}/api/notifications/stream`, {
        headers: { Authorization: `Bearer ${first.token}` },
        signal: controller.signal,
      });
      assert.equal(stream.status, 200);
      const reader = stream.body.getReader();
      assert.equal((await reader.read()).done, false);
      readers.push(reader);
    }
    assert.equal((await request('/api/notifications/stream', first)).status, 429);
    const closed = readers[0].read().then(
      (result) => result.done,
      () => true,
    );
    assert.equal((await request('/api/auth/logout', null, 'POST', { refreshToken: first.refreshToken })).status, 204);
    let closeTimeout;
    try {
      assert.equal(
        await Promise.race([
          closed,
          new Promise((_, reject) => {
            closeTimeout = setTimeout(() => reject(new Error('Revoked SSE did not close within 5 seconds')), 5000);
          }),
        ]),
        true,
      );
    } finally {
      clearTimeout(closeTimeout);
    }
    for (const controller of streamControllers) controller.abort();
    assert.equal((await request('/api/characters', first)).status, 401);
    assert.equal((await request('/api/characters', second)).status, 200);
    assert.equal((await request('/api/auth/refresh', null, 'POST', { refreshToken: first.refreshToken })).status, 401);

    const rotations = await Promise.all(
      Array.from({ length: 5 }, () =>
        request('/api/auth/refresh', null, 'POST', { refreshToken: second.refreshToken }),
      ),
    );
    assert.deepEqual(rotations.map((response) => response.status).sort(), [200, 401, 401, 401, 401]);
    const rotated = await rotations.find((response) => response.status === 200).json();
    assert.equal(jwt.decode(rotated.token).sid, jwt.decode(second.token).sid);
    // A token from the same session still identifies that session after rotation.
    await request('/api/auth/logout', null, 'POST', { refreshToken: second.refreshToken });
    assert.equal((await request('/api/characters', rotated)).status, 401);

    const changing = await session('/api/auth/login');
    const other = await session('/api/auth/login');
    const changed = await request('/api/auth/change-password', changing, 'POST', {
      currentPassword: password,
      newPassword,
    });
    assert.equal(changed.status, 204);
    for (const old of [changing, other]) {
      assert.equal((await request('/api/characters', old)).status, 401);
      assert.equal((await request('/api/auth/refresh', null, 'POST', { refreshToken: old.refreshToken })).status, 401);
    }
    const current = await session('/api/auth/login', newPassword);
    for (const long of ['a'.repeat(73), 'ą'.repeat(37)]) {
      assert.equal(
        (await request('/api/auth/register', null, 'POST', { username: 'unused_fixture', password: long })).status,
        400,
      );
      assert.equal(
        (
          await request('/api/auth/change-password', current, 'POST', {
            currentPassword: newPassword,
            newPassword: long,
          })
        ).status,
        400,
      );
    }

    const userId = current.user.id;
    await pool.query(`INSERT INTO characters(owner_id,name) SELECT $1,'quota fixture' FROM generate_series(1,99)`, [
      userId,
    ]);
    const attempts = await Promise.all(
      Array.from({ length: 2 }, () =>
        request('/api/characters', current, 'POST', { name: 'Last slot', attributes: {} }),
      ),
    );
    assert.deepEqual(attempts.map((res) => res.status).sort(), [201, 409]);
    const quota = await attempts.find((res) => res.status === 409).json();
    assert.equal(quota.error, 'resource_quota_exceeded');
    const count = await pool.query('SELECT count(*)::int AS count FROM characters WHERE owner_id=$1', [userId]);
    assert.equal(count.rows[0].count, 100);

    const legacyPassword = 'l'.repeat(80);
    await pool.query('INSERT INTO users(username,password_hash) VALUES ($1,$2)', [
      legacyUsername,
      await bcrypt.hash(legacyPassword, 4),
    ]);
    const legacy = await request('/api/auth/login', null, 'POST', {
      username: legacyUsername,
      password: legacyPassword,
    });
    assert.equal(legacy.status, 200, 'Existing long passwords must still allow migration through login');

    assert.equal((await request('/api/auth/account', current, 'DELETE', { password: newPassword })).status, 204);
    assert.equal((await request('/api/characters', current)).status, 401);
    console.log(
      'PASS: session isolation, logout/rotation, password revocation, bcrypt bounds, concurrent quotas, CORS and deletion',
    );
  } finally {
    for (const controller of streamControllers) controller.abort();
    await pool.query('DELETE FROM users WHERE username=ANY($1::text[])', [[username, legacyUsername]]);
    await pool.end();
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
