require('dotenv').config({ path: require('node:path').resolve(__dirname, '../../.env') });

const assert = require('node:assert/strict');
const { pool } = require('../src/db');

const apiBase = process.env.API_BASE || `http://127.0.0.1:${process.env.PORT || 3000}`;
const suffix = Date.now();
const firstUsername = `friend_a_${suffix}`;
const secondUsername = `friend_b_${suffix}`;
const password = 'Friend-test-password-123!';

async function request(path, options = {}) {
  return fetch(`${apiBase}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
}

async function register(username) {
  const response = await request('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });
  assert.equal(response.status, 201);
  return response.json();
}

async function createCharacter(session, name) {
  const response = await request('/api/characters', {
    method: 'POST',
    headers: { Authorization: `Bearer ${session.token}` },
    body: JSON.stringify({
      name,
      race: 'Człowiek',
      classes: 'Wędrowiec',
      level: 1,
      attributes: {},
    }),
  });
  assert.equal(response.status, 201);
  return response.json();
}

async function run() {
  try {
    const first = await register(firstUsername);
    const second = await register(secondUsername);
    const firstCharacter = await createCharacter(first, 'Pierwsza postać');
    const secondCharacter = await createCharacter(second, 'Druga postać');

    const inviteResponse = await request('/api/friends/invite', {
      method: 'POST',
      headers: { Authorization: `Bearer ${first.token}` },
      body: '{}',
    });
    assert.equal(inviteResponse.status, 201);
    const invite = await inviteResponse.json();
    assert.equal(invite.code.length, 8);

    const acceptResponse = await request('/api/friends/accept', {
      method: 'POST',
      headers: { Authorization: `Bearer ${second.token}` },
      body: JSON.stringify({ code: invite.code }),
    });
    assert.equal(acceptResponse.status, 201);

    const firstListResponse = await request('/api/friends', {
      headers: { Authorization: `Bearer ${first.token}` },
    });
    const secondListResponse = await request('/api/friends', {
      headers: { Authorization: `Bearer ${second.token}` },
    });
    assert.equal(firstListResponse.status, 200);
    assert.equal(secondListResponse.status, 200);
    assert.equal((await firstListResponse.json())[0].username, secondUsername);
    assert.equal((await secondListResponse.json())[0].username, firstUsername);

    const profileResponse = await request(`/api/friends/${second.user.id}/profile`, {
      headers: { Authorization: `Bearer ${first.token}` },
    });
    assert.equal(profileResponse.status, 200);
    assert.equal((await profileResponse.json()).username, secondUsername);

    const sendResponse = await request(`/api/friends/${second.user.id}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${first.token}` },
      body: JSON.stringify({ body: 'Testowa wiadomość' }),
    });
    assert.equal(sendResponse.status, 201);

    const messageNotificationsResponse = await request('/api/notifications', {
      headers: { Authorization: `Bearer ${second.token}` },
    });
    assert.equal(messageNotificationsResponse.status, 200);
    const messageNotifications = await messageNotificationsResponse.json();
    assert.equal(messageNotifications.messages[0].body, 'Testowa wiadomość');
    assert.equal(messageNotifications.messages[0].sender.username, firstUsername);

    const messagesResponse = await request(`/api/friends/${first.user.id}/messages`, {
      headers: { Authorization: `Bearer ${second.token}` },
    });
    assert.equal(messagesResponse.status, 200);
    const messages = await messagesResponse.json();
    assert.equal(messages[0].body, 'Testowa wiadomość');
    assert.equal(messages[0].sentByMe, false);

    const secondMessageResponse = await request(`/api/friends/${second.user.id}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${first.token}` },
      body: JSON.stringify({ body: 'Druga wiadomość' }),
    });
    assert.equal(secondMessageResponse.status, 201);
    const firstPageResponse = await request(`/api/friends/${first.user.id}/messages?limit=1`, {
      headers: { Authorization: `Bearer ${second.token}` },
    });
    assert.equal(firstPageResponse.headers.get('x-has-more'), 'true');
    const firstPage = await firstPageResponse.json();
    assert.equal(firstPage[0].body, 'Druga wiadomość');
    const cursor = firstPageResponse.headers.get('x-next-cursor');
    const olderPageResponse = await request(`/api/friends/${first.user.id}/messages?limit=1&before=${cursor}`, {
      headers: { Authorization: `Bearer ${second.token}` },
    });
    assert.equal((await olderPageResponse.json())[0].body, 'Testowa wiadomość');

    const nicknameResponse = await request(`/api/friends/${second.user.id}/nickname`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${first.token}` },
      body: JSON.stringify({ nickname: 'Mistrz Gry' }),
    });
    assert.equal(nicknameResponse.status, 200);
    const renamedList = await request('/api/friends', {
      headers: { Authorization: `Bearer ${first.token}` },
    });
    assert.equal((await renamedList.json())[0].nickname, 'Mistrz Gry');

    const campaignResponse = await request('/api/campaigns', {
      method: 'POST',
      headers: { Authorization: `Bearer ${first.token}` },
      body: JSON.stringify({ name: 'Testowa kampania' }),
    });
    assert.equal(campaignResponse.status, 201);
    const campaign = await campaignResponse.json();

    const campaignInvite = await request(`/api/campaigns/${campaign.id}/invitations`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${first.token}` },
      body: JSON.stringify({ friendId: second.user.id, characterId: firstCharacter.id }),
    });
    assert.equal(campaignInvite.status, 201);
    const campaignNotificationsResponse = await request('/api/notifications', {
      headers: { Authorization: `Bearer ${second.token}` },
    });
    assert.equal(campaignNotificationsResponse.status, 200);
    const campaignNotifications = await campaignNotificationsResponse.json();
    assert.equal(campaignNotifications.messages.length, 0);
    assert.equal(campaignNotifications.campaignInvitations[0].campaign.name, 'Testowa kampania');
    const invitationsResponse = await request('/api/campaign-invitations', {
      headers: { Authorization: `Bearer ${second.token}` },
    });
    const invitations = await invitationsResponse.json();
    assert.equal(invitations[0].campaign.name, 'Testowa kampania');
    const acceptCampaign = await request(`/api/campaign-invitations/${invitations[0].id}/respond`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${second.token}` },
      body: JSON.stringify({ action: 'accept', characterId: secondCharacter.id }),
    });
    assert.equal(acceptCampaign.status, 204);

    const teamResponse = await request(`/api/characters/${secondCharacter.id}/teams`, {
      headers: { Authorization: `Bearer ${second.token}` },
    });
    assert.equal(teamResponse.status, 200);
    const teams = await teamResponse.json();
    assert.equal(teams[0].name, 'Testowa kampania');
    assert.equal(teams[0].members.length, 2);

    const forbiddenDmPanel = await request(`/api/campaigns/${campaign.id}/dm`, {
      headers: { Authorization: `Bearer ${second.token}` },
    });
    assert.equal(forbiddenDmPanel.status, 403);

    const dmNoteResponse = await request(`/api/campaigns/${campaign.id}/dm/note`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${first.token}` },
      body: JSON.stringify({ content: 'Sekretna notatka prowadzącego' }),
    });
    assert.equal(dmNoteResponse.status, 204);

    const characterNoteResponse = await request(
      `/api/campaigns/${campaign.id}/dm/characters/${secondCharacter.id}/note`,
      {
        method: 'PUT',
        headers: { Authorization: `Bearer ${first.token}` },
        body: JSON.stringify({ content: 'Postać zna ukryte przejście' }),
      },
    );
    assert.equal(characterNoteResponse.status, 204);

    const dmInventoryResponse = await request(
      `/api/campaigns/${campaign.id}/dm/characters/${secondCharacter.id}/inventory`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${first.token}` },
        body: JSON.stringify({ name: 'Mikstura testowa', quantity: 2, duration: '3 tury', icon: 'potion' }),
      },
    );
    assert.equal(dmInventoryResponse.status, 201);
    assert.match((await dmInventoryResponse.json()).inventory, /Mikstura testowa × 2/);

    const dmPanelResponse = await request(`/api/campaigns/${campaign.id}/dm`, {
      headers: { Authorization: `Bearer ${first.token}` },
    });
    assert.equal(dmPanelResponse.status, 200);
    const dmPanel = await dmPanelResponse.json();
    assert.equal(dmPanel.generalNote, 'Sekretna notatka prowadzącego');
    assert.equal(dmPanel.members.length, 2);
    assert.equal(
      dmPanel.members.find((member) => member.id === secondCharacter.id).dmNote,
      'Postać zna ukryte przejście',
    );

    const dmCharacterResponse = await request(`/api/campaigns/${campaign.id}/dm/characters/${secondCharacter.id}`, {
      headers: { Authorization: `Bearer ${first.token}` },
    });
    assert.equal(dmCharacterResponse.status, 200);
    const dmCharacter = await dmCharacterResponse.json();
    assert.equal(dmCharacter.dmNote, 'Postać zna ukryte przejście');
    assert.match(dmCharacter.inventory, /Mikstura testowa × 2/);

    const teammateResponse = await request(`/api/campaigns/${campaign.id}/characters/${firstCharacter.id}`, {
      headers: { Authorization: `Bearer ${second.token}` },
    });
    assert.equal(teammateResponse.status, 200);
    assert.equal((await teammateResponse.json()).name, 'Pierwsza postać');

    const leaveCampaignResponse = await request(`/api/characters/${secondCharacter.id}/campaigns/${campaign.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${second.token}` },
    });
    assert.equal(leaveCampaignResponse.status, 204);

    const reportResponse = await request(`/api/users/${second.user.id}/report`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${first.token}` },
      body: JSON.stringify({ reason: 'other', details: 'Test automatyczny' }),
    });
    assert.equal(reportResponse.status, 201);

    const removeResponse = await request(`/api/friends/${second.user.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${first.token}` },
    });
    assert.equal(removeResponse.status, 204);

    const secondInviteResponse = await request('/api/friends/invite', {
      method: 'POST',
      headers: { Authorization: `Bearer ${first.token}` },
      body: '{}',
    });
    const secondInvite = await secondInviteResponse.json();
    const secondAcceptResponse = await request('/api/friends/accept', {
      method: 'POST',
      headers: { Authorization: `Bearer ${second.token}` },
      body: JSON.stringify({ code: secondInvite.code }),
    });
    assert.equal(secondAcceptResponse.status, 201);

    const blockResponse = await request(`/api/users/${second.user.id}/block`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${first.token}` },
      body: '{}',
    });
    assert.equal(blockResponse.status, 204);
    const afterBlockList = await request('/api/friends', {
      headers: { Authorization: `Bearer ${first.token}` },
    });
    assert.deepEqual(await afterBlockList.json(), []);

    console.log('Friends smoke test passed');
  } finally {
    await pool.query('DELETE FROM users WHERE username = ANY($1::text[])', [[firstUsername, secondUsername]]);
    await pool.end();
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
