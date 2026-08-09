require('dotenv').config({ path: require('node:path').resolve(__dirname, '../../.env') });

const assert = require('node:assert/strict');
const { pool } = require('../src/db');

const apiBase = process.env.API_BASE
  || `http://${process.env.HOST || '127.0.0.1'}:${process.env.PORT || 3000}`;
const username = `smoke_${Date.now()}`;
const password = 'Smoke-test-password-123!';
const newPassword = 'Changed-smoke-password-456!';

async function request(path, options = {}) {
  return fetch(`${apiBase}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
}

async function run() {
  try {
    const registration = await request('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
    assert.equal(registration.status, 201);
    const firstSession = await registration.json();
    assert.ok(firstSession.token);
    assert.ok(firstSession.refreshToken);

    const protectedRequest = await request('/api/characters', {
      headers: { Authorization: `Bearer ${firstSession.token}` },
    });
    assert.equal(protectedRequest.status, 200);
    assert.deepEqual(await protectedRequest.json(), []);

    const creation = await request('/api/characters', {
      method: 'POST',
      headers: { Authorization: `Bearer ${firstSession.token}` },
      body: JSON.stringify({
        name: 'Arannis',
        race: 'Elf',
        classes: 'Łowca / zwiadowca',
        level: 3,
        age: 24,
        height: '1,82 m',
        points: 34,
        minimumPoints: -10,
        guildRank: 'F',
        inventory: 'Młot kowalski\nTarcza',
        attributes: {
          strength: 10,
          dexterity: 3,
          constitution: 16,
          intelligence: -6,
          wisdom: 3,
          charisma: 8,
        },
        combat: {
          hp: { value: '62', formula: '2 × KOND + 30' },
        },
        skills: {
          strengthPower: { percent: 150 },
          intuition: { percent: 100 },
          rhetoric: { percent: 125 },
        },
        customSkills: [
          { group: 'strength', name: 'Kowalstwo', percent: 125 },
          { group: 'intelligence', name: 'Szyfry', percent: 50 },
        ],
        special: {
          animalCare: { current: 0, max: 11 },
        },
        features: {
          passives: [
            { name: 'Twarda skóra', description: 'Stała odporność na obrażenia.' },
          ],
          campActions: [
            { name: 'Naprawa ekwipunku', description: 'Naprawia wyposażenie podczas obozu.', duration: '1 godzina' },
          ],
          abilities: [
            { name: 'Uderzenie tarczą', description: 'Atak i próba odepchnięcia celu.', toothCost: 3 },
          ],
        },
      }),
    });
    assert.equal(creation.status, 201);
    const character = await creation.json();
    assert.equal(character.name, 'Arannis');
    assert.equal(character.level, 3);
    assert.deepEqual(character.attributes.strength, { adventure: 10, combat: 5 });
    assert.deepEqual(character.attributes.dexterity, { adventure: 3, combat: 1 });
    assert.deepEqual(character.attributes.intelligence, { adventure: -6, combat: -6 });
    assert.deepEqual(character.attributes.charisma, { adventure: 8, combat: 8 });
    assert.equal(character.auxiliary.reflex.value, '3');
    assert.equal(character.auxiliary.intuition.value, '-6');
    assert.equal(character.auxiliary.arcana.value, '1');
    assert.equal(character.auxiliary.perception.value, '-6');
    assert.equal(character.skills.strengthPower.result, 15);
    assert.equal(character.skills.intuition.result, -6);
    assert.equal(character.skills.alchemy.result, 0);
    assert.equal(character.skills.rhetoric.result, 10);
    assert.deepEqual(character.customSkills, [
      { group: 'strength', name: 'Kowalstwo', percent: 125, result: 12 },
      { group: 'intelligence', name: 'Szyfry', percent: 50, result: -6 },
    ]);
    assert.deepEqual(character.special.animalCare, { current: 0, max: 11 });
    assert.deepEqual(character.features.passives[0], {
      name: 'Twarda skóra',
      description: 'Stała odporność na obrażenia.',
      cooldown: '',
    });
    assert.equal(character.inventory, 'Młot kowalski\nTarcza');

    const inventoryUpdate = await request(`/api/characters/${character.id}/inventory`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${firstSession.token}` },
      body: JSON.stringify({ inventory: 'Młot kowalski\nTarcza\nMikstura leczenia' }),
    });
    assert.equal(inventoryUpdate.status, 200);
    assert.equal((await inventoryUpdate.json()).inventory, 'Młot kowalski\nTarcza\nMikstura leczenia');

    const update = await request(`/api/characters/${character.id}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${firstSession.token}` },
      body: JSON.stringify({
        name: 'Arannis',
        race: 'Elf',
        classes: 'Łowca / zwiadowca',
        level: 4,
        attributes: {
          strength: 11,
          intelligence: -7,
          charisma: 9,
        },
      }),
    });
    assert.equal(update.status, 200);
    const updatedCharacter = await update.json();
    assert.equal(updatedCharacter.level, 4);
    assert.equal(updatedCharacter.attributes.strength.combat, 5);
    assert.equal(updatedCharacter.attributes.intelligence.combat, -7);
    assert.equal(updatedCharacter.attributes.charisma.combat, 9);

    const refresh = await request('/api/auth/refresh', {
      method: 'POST',
      body: JSON.stringify({ refreshToken: firstSession.refreshToken }),
    });
    assert.equal(refresh.status, 200);
    const secondSession = await refresh.json();
    assert.notEqual(secondSession.refreshToken, firstSession.refreshToken);

    const deletion = await request(`/api/characters/${character.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${secondSession.token}` },
    });
    assert.equal(deletion.status, 204);

    const reuse = await request('/api/auth/refresh', {
      method: 'POST',
      body: JSON.stringify({ refreshToken: firstSession.refreshToken }),
    });
    assert.equal(reuse.status, 401);

    const logout = await request('/api/auth/logout', {
      method: 'POST',
      body: JSON.stringify({ refreshToken: secondSession.refreshToken }),
    });
    assert.equal(logout.status, 204);

    const afterLogout = await request('/api/auth/refresh', {
      method: 'POST',
      body: JSON.stringify({ refreshToken: secondSession.refreshToken }),
    });
    assert.equal(afterLogout.status, 401);

    const loginBeforeChange = await request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
    assert.equal(loginBeforeChange.status, 200);
    const passwordSession = await loginBeforeChange.json();

    const passwordChange = await request('/api/auth/change-password', {
      method: 'POST',
      headers: { Authorization: `Bearer ${passwordSession.token}` },
      body: JSON.stringify({ currentPassword: password, newPassword }),
    });
    assert.equal(passwordChange.status, 204);

    const oldPasswordLogin = await request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
    assert.equal(oldPasswordLogin.status, 401);

    const newPasswordLogin = await request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password: newPassword }),
    });
    assert.equal(newPasswordLogin.status, 200);
    const finalSession = await newPasswordLogin.json();

    const rejectedAccountDeletion = await request('/api/auth/account', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${finalSession.token}` },
      body: JSON.stringify({ password: 'incorrect-password' }),
    });
    assert.equal(rejectedAccountDeletion.status, 401);

    const accountDeletion = await request('/api/auth/account', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${finalSession.token}` },
      body: JSON.stringify({ password: newPassword }),
    });
    assert.equal(accountDeletion.status, 204);

    const deletedUser = await pool.query(
      'SELECT 1 FROM users WHERE username = $1',
      [username]
    );
    assert.equal(deletedUser.rowCount, 0);

    console.log('Authentication smoke test passed');
  } finally {
    await pool.query('DELETE FROM users WHERE username = $1', [username]);
    await pool.end();
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
