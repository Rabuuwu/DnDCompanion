require('./test-safety').requireTestEnvironment();

const assert = require('node:assert/strict');
const test = require('node:test');
const { pool } = require('../src/db');

const apiBase = process.env.API_BASE;
if (!apiBase || !['127.0.0.1', 'localhost', '[::1]'].includes(new URL(apiBase).hostname)) {
  throw new Error('Security integration tests require an explicit loopback API_BASE');
}
const password = 'Security-test-password-123!';
const suffix = `${Date.now()}_${process.pid}`;
const usernames = [`sec_owner_${suffix}`, `sec_outside_${suffix}`];

async function request(path, session, method = 'GET', body) {
  return fetch(`${apiBase}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(session ? { Authorization: `Bearer ${session.token}` } : {}),
    },
    ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
  });
}
async function json(path, session, method, body, status) {
  const response = await request(path, session, method, body);
  assert.equal(response.status, status, await response.clone().text());
  return response.json();
}

test('isolated API access control, parser and session contracts', async (t) => {
  try {
    const owner = await json('/api/auth/register', null, 'POST', { username: usernames[0], password }, 201);
    const outsider = await json('/api/auth/register', null, 'POST', { username: usernames[1], password }, 201);
    const characterBody = { name: 'Private character', race: 'Human', classes: 'Ranger', attributes: {} };
    const character = await json('/api/characters', owner, 'POST', characterBody, 201);
    const campaign = await json('/api/campaigns', owner, 'POST', { name: 'Private campaign' }, 201);
    await json(`/api/campaigns/${campaign.id}/dm/secrets`, owner, 'POST', { title: 'Private secret' }, 201);

    await t.test('missing and malformed bearer credentials cannot read characters', async () => {
      for (const session of [null, { token: 'invalid' }]) {
        assert.equal((await request(`/api/characters/${character.id}`, session)).status, 401);
      }
    });
    await t.test('outsider cannot read, replace, patch or delete another character', async () => {
      for (const [method, path, body] of [
        ['GET', '', undefined],
        ['PUT', '', { ...characterBody, name: 'Stolen' }],
        ['PATCH', '/inventory', { inventory: 'Stolen' }],
        ['PATCH', '/notebook', { notebook: 'Stolen' }],
        ['DELETE', '', undefined],
      ]) {
        assert.equal((await request(`/api/characters/${character.id}${path}`, outsider, method, body)).status, 404);
      }
      const unchanged = await json(`/api/characters/${character.id}`, owner, 'GET', undefined, 200);
      assert.equal(unchanged.name, characterBody.name);
    });
    await t.test('outsider cannot read DM secrets or export a campaign', async () => {
      for (const path of ['secrets', 'export', 'dashboard']) {
        assert.equal((await request(`/api/campaigns/${campaign.id}/dm/${path}`, outsider)).status, 403);
      }
      assert.equal((await request(`/api/campaigns/${campaign.id}/shared`, outsider)).status, 404);
      const secrets = await json(`/api/campaigns/${campaign.id}/dm/secrets`, owner, 'GET', undefined, 200);
      assert.ok(JSON.stringify(secrets).includes('Private secret'));
    });
    await t.test('invalid identifiers and empty character names return validation errors', async () => {
      assert.equal((await request('/api/characters/not-a-number', owner)).status, 400);
      assert.equal((await request('/api/characters', owner, 'POST', { ...characterBody, name: '' })).status, 400);
    });
    await t.test('real Express parser rejects malformed JSON and oversized payloads', async () => {
      const malformed = await json('/api/characters', owner, 'POST', '{', 400);
      assert.deepEqual(malformed, { error: 'invalid_json' });
      const oversized = await json('/api/characters', owner, 'POST', { padding: 'x'.repeat(1_100_000) }, 413);
      assert.deepEqual(oversized, { error: 'payload_too_large' });
    });
    await t.test('simultaneous refresh consumes one token once and repeated logout is safe', async () => {
      const attempts = await Promise.all(
        Array.from({ length: 5 }, () =>
          request('/api/auth/refresh', null, 'POST', { refreshToken: owner.refreshToken }),
        ),
      );
      assert.deepEqual(attempts.map((response) => response.status).sort(), [200, 401, 401, 401, 401]);
      const winner = await attempts.find((response) => response.status === 200).json();
      const active = await pool.query(
        'SELECT count(*)::int AS count FROM refresh_tokens WHERE user_id = $1 AND revoked_at IS NULL',
        [owner.user.id],
      );
      assert.equal(active.rows[0].count, 1);
      for (let attempt = 0; attempt < 2; attempt += 1) {
        assert.equal(
          (await request('/api/auth/logout', null, 'POST', { refreshToken: winner.refreshToken })).status,
          204,
        );
      }
      assert.equal(
        (await request('/api/auth/refresh', null, 'POST', { refreshToken: winner.refreshToken })).status,
        401,
      );
    });
    await t.test('refresh rollback preserves the old session when replacement insert fails', async () => {
      const userId = Number(outsider.user.id);
      assert.ok(Number.isSafeInteger(userId));
      // Test database only: fail the replacement INSERT for this test account.
      // The trigger and function are removed before retry, even on assertion failure.
      await pool.query(`CREATE FUNCTION career_test_refresh_failure() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN RAISE EXCEPTION 'test-only replacement token failure'; END $$`);
      try {
        await pool.query(`CREATE TRIGGER career_test_refresh_failure
          BEFORE INSERT ON refresh_tokens FOR EACH ROW WHEN (NEW.user_id = ${userId})
          EXECUTE FUNCTION career_test_refresh_failure()`);
        try {
          const failed = await json('/api/auth/refresh', null, 'POST', { refreshToken: outsider.refreshToken }, 500);
          assert.deepEqual(failed, { error: 'server_error' });
          const state = await pool.query(
            'SELECT count(*)::int AS count FROM refresh_tokens WHERE user_id = $1 AND revoked_at IS NULL',
            [userId],
          );
          assert.equal(state.rows[0].count, 1);
        } finally {
          await pool.query('DROP TRIGGER career_test_refresh_failure ON refresh_tokens');
        }
      } finally {
        await pool.query('DROP FUNCTION career_test_refresh_failure()');
      }
      const recovered = await json('/api/auth/refresh', null, 'POST', { refreshToken: outsider.refreshToken }, 200);
      assert.notEqual(recovered.refreshToken, outsider.refreshToken);
    });
  } finally {
    await pool.query('DELETE FROM users WHERE username = ANY($1::text[])', [usernames]);
    await pool.end();
  }
});
