const { pool } = require('./db');
const { serializeCharacter } = require('./characters');
const { publishUserNotification } = require('./notifications');

function parseId(value) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

async function requireCampaignDm(campaignId, userId) {
  const result = await pool.query(
    'SELECT id, name FROM campaigns WHERE id = $1 AND owner_id = $2',
    [campaignId, userId]
  );
  return result.rows[0] || null;
}

function dmNote(value) {
  return String(value || '').slice(0, 50_000);
}

async function listOwnedCampaigns(req, res) {
  const requestedLimit = Number(req.query.limit || 50);
  const requestedOffset = Number(req.query.offset || 0);
  const limit = Number.isSafeInteger(requestedLimit) ? Math.max(1, Math.min(100, requestedLimit)) : 50;
  const offset = Number.isSafeInteger(requestedOffset) ? Math.max(0, Math.min(10_000, requestedOffset)) : 0;
  const result = await pool.query(
    `SELECT id, name, created_at
     FROM campaigns
     WHERE owner_id = $1
     ORDER BY LOWER(name), id
     LIMIT $2 OFFSET $3`,
    [req.user.id, limit + 1, offset]
  );
  const hasMore = result.rows.length > limit;
  const rows = result.rows.slice(0, limit);
  res.set('X-Has-More', String(hasMore));
  if (hasMore) res.set('X-Next-Offset', String(offset + limit));
  return res.json(rows.map((campaign) => ({
    id: Number(campaign.id),
    name: campaign.name,
    createdAt: campaign.created_at,
  })));
}

async function createCampaign(req, res) {
  const name = String(req.body?.name || '').trim();
  if (!name || name.length > 100) return res.status(400).json({ error: 'invalid_campaign_name' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(
      `INSERT INTO campaigns (owner_id, name)
       VALUES ($1, $2)
       RETURNING id, name, created_at`,
      [req.user.id, name]
    );
    const campaign = result.rows[0];
    await client.query(
      `INSERT INTO campaign_members (campaign_id, user_id, role)
       VALUES ($1, $2, 'owner')`,
      [campaign.id, req.user.id]
    );
    await client.query('COMMIT');
    return res.status(201).json({
      id: Number(campaign.id),
      name: campaign.name,
      createdAt: campaign.created_at,
    });
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function inviteToCampaign(req, res) {
  const campaignId = parseId(req.params.id);
  const friendId = parseId(req.body?.friendId);
  const characterId = parseId(req.body?.characterId);
  if (!campaignId || !friendId || !characterId) {
    return res.status(400).json({ error: 'invalid_invitation' });
  }

  const campaign = await pool.query(
    'SELECT id, name FROM campaigns WHERE id = $1 AND owner_id = $2',
    [campaignId, req.user.id]
  );
  if (!campaign.rows[0]) return res.status(404).json({ error: 'campaign_not_found' });

  const character = await pool.query(
    'SELECT id FROM characters WHERE id = $1 AND owner_id = $2',
    [characterId, req.user.id]
  );
  if (!character.rows[0]) return res.status(404).json({ error: 'character_not_found' });

  const lowId = Math.min(req.user.id, friendId);
  const highId = Math.max(req.user.id, friendId);
  const friendship = await pool.query(
    `SELECT 1 FROM friendships WHERE user_low_id = $1 AND user_high_id = $2`,
    [lowId, highId]
  );
  if (friendship.rowCount === 0) return res.status(404).json({ error: 'friend_not_found' });

  const member = await pool.query(
    'SELECT 1 FROM campaign_members WHERE campaign_id = $1 AND user_id = $2',
    [campaignId, friendId]
  );
  if (member.rowCount > 0) return res.status(409).json({ error: 'already_campaign_member' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO campaign_members (campaign_id, user_id, character_id, role)
       VALUES ($1, $2, $3, 'owner')
       ON CONFLICT (campaign_id, user_id)
       DO UPDATE SET character_id = EXCLUDED.character_id`,
      [campaignId, req.user.id, characterId]
    );
    const result = await client.query(
      `INSERT INTO campaign_invitations (campaign_id, inviter_id, invitee_id)
       VALUES ($1, $2, $3)
       RETURNING id, created_at`,
      [campaignId, req.user.id, friendId]
    );
    await client.query('COMMIT');
    publishUserNotification(friendId, {
      type: 'campaign',
      invitationId: Number(result.rows[0].id),
    });
    return res.status(201).json({
      invitationId: Number(result.rows[0].id),
      campaignName: campaign.rows[0].name,
      createdAt: result.rows[0].created_at,
    });
  } catch (error) {
    await client.query('ROLLBACK');
    if (error.code === '23505') return res.status(409).json({ error: 'invitation_already_pending' });
    throw error;
  } finally {
    client.release();
  }
}

async function listCampaignInvitations(req, res) {
  const result = await pool.query(
    `SELECT ci.id, c.id AS campaign_id, c.name AS campaign_name,
            u.id AS inviter_id, u.username AS inviter_username, u.avatar AS inviter_avatar, ci.created_at
     FROM campaign_invitations ci
     JOIN campaigns c ON c.id = ci.campaign_id
     JOIN users u ON u.id = ci.inviter_id
     WHERE ci.invitee_id = $1 AND ci.status = 'pending'
     ORDER BY ci.created_at DESC`,
    [req.user.id]
  );
  return res.json(result.rows.map((invitation) => ({
    id: Number(invitation.id),
    campaign: { id: Number(invitation.campaign_id), name: invitation.campaign_name },
    inviter: {
      id: Number(invitation.inviter_id),
      username: invitation.inviter_username,
      avatar: invitation.inviter_avatar || '',
    },
    createdAt: invitation.created_at,
  })));
}

async function respondToCampaignInvitation(req, res) {
  const invitationId = parseId(req.params.id);
  const action = String(req.body?.action || '');
  if (!invitationId || !['accept', 'decline'].includes(action)) {
    return res.status(400).json({ error: 'invalid_invitation_response' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(
      `SELECT id, campaign_id
       FROM campaign_invitations
       WHERE id = $1 AND invitee_id = $2 AND status = 'pending'
       FOR UPDATE`,
      [invitationId, req.user.id]
    );
    const invitation = result.rows[0];
    if (!invitation) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'invitation_not_found' });
    }

    if (action === 'accept') {
      const characterId = parseId(req.body?.characterId);
      if (!characterId) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'character_required' });
      }
      const character = await client.query(
        'SELECT id FROM characters WHERE id = $1 AND owner_id = $2',
        [characterId, req.user.id]
      );
      if (!character.rows[0]) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'character_not_found' });
      }
      await client.query(
        `INSERT INTO campaign_members (campaign_id, user_id, character_id)
         VALUES ($1, $2, $3)
         ON CONFLICT (campaign_id, user_id)
         DO UPDATE SET character_id = EXCLUDED.character_id`,
        [invitation.campaign_id, req.user.id, characterId]
      );
    }
    await client.query(
      `UPDATE campaign_invitations
       SET status = $1, responded_at = NOW()
       WHERE id = $2`,
      [action === 'accept' ? 'accepted' : 'declined', invitationId]
    );
    await client.query('COMMIT');
    return res.status(204).end();
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function listCharacterTeams(req, res) {
  const characterId = parseId(req.params.characterId);
  if (!characterId) return res.status(400).json({ error: 'invalid_character_id' });

  const ownedCharacter = await pool.query(
    'SELECT 1 FROM characters WHERE id = $1 AND owner_id = $2',
    [characterId, req.user.id]
  );
  if (!ownedCharacter.rows[0]) return res.status(404).json({ error: 'character_not_found' });

  const result = await pool.query(
    `SELECT c.id AS campaign_id, c.name AS campaign_name, c.owner_id, cm.joined_at,
            member_character.id AS character_id, member_character.name AS character_name,
            member_character.data, member_character.created_at, member_character.updated_at,
            u.id AS user_id, u.username
     FROM campaign_members own_membership
     JOIN campaigns c ON c.id = own_membership.campaign_id
     JOIN campaign_members cm ON cm.campaign_id = c.id
     JOIN characters member_character ON member_character.id = cm.character_id
     JOIN users u ON u.id = cm.user_id
     WHERE own_membership.character_id = $1
       AND own_membership.user_id = $2
     ORDER BY LOWER(c.name), c.id, cm.joined_at, member_character.id`,
    [characterId, req.user.id]
  );

  const campaigns = new Map();
  for (const row of result.rows) {
    if (!campaigns.has(row.campaign_id)) {
      campaigns.set(row.campaign_id, {
        id: Number(row.campaign_id),
        name: row.campaign_name,
        isDm: Number(row.owner_id) === req.user.id,
        members: [],
      });
    }
    const member = serializeCharacter({
      id: row.character_id,
      name: row.character_name,
      data: row.data,
      created_at: row.created_at,
      updated_at: row.updated_at,
    });
    campaigns.get(row.campaign_id).members.push({
      id: member.id,
      name: member.name,
      avatar: member.avatar,
      motto: member.motto,
      race: member.race,
      classes: member.classes,
      level: member.level,
      user: { id: Number(row.user_id), username: row.username },
      isCurrent: member.id === characterId,
      isDm: Number(row.user_id) === Number(row.owner_id),
    });
  }
  return res.json([...campaigns.values()]);
}

async function getDmPanel(req, res) {
  const campaignId = parseId(req.params.id);
  if (!campaignId) return res.status(400).json({ error: 'invalid_campaign_id' });
  const campaign = await requireCampaignDm(campaignId, req.user.id);
  if (!campaign) return res.status(403).json({ error: 'dm_access_required' });

  const [members, generalNote] = await Promise.all([
    pool.query(
      `SELECT ch.id, ch.name, ch.data, u.id AS user_id, u.username,
              COALESCE(notes.content, '') AS dm_note
       FROM campaign_members cm
       JOIN characters ch ON ch.id = cm.character_id
       JOIN users u ON u.id = cm.user_id
       LEFT JOIN campaign_character_dm_notes notes
         ON notes.campaign_id = cm.campaign_id
        AND notes.dm_user_id = $2
        AND notes.character_id = ch.id
       WHERE cm.campaign_id = $1
       ORDER BY cm.joined_at, ch.id`,
      [campaignId, req.user.id]
    ),
    pool.query(
      'SELECT content FROM campaign_dm_notes WHERE campaign_id = $1 AND dm_user_id = $2',
      [campaignId, req.user.id]
    ),
  ]);

  return res.json({
    campaign: { id: Number(campaign.id), name: campaign.name },
    generalNote: generalNote.rows[0]?.content || '',
    members: members.rows.map((row) => {
      const character = serializeCharacter({ id: row.id, name: row.name, data: row.data });
      return {
        id: character.id,
        name: character.name,
        avatar: character.avatar,
        race: character.race,
        classes: character.classes,
        level: character.level,
        user: { id: Number(row.user_id), username: row.username },
        dmNote: row.dm_note,
      };
    }),
  });
}

async function getDmCharacter(req, res) {
  const campaignId = parseId(req.params.campaignId);
  const characterId = parseId(req.params.characterId);
  if (!campaignId || !characterId) return res.status(400).json({ error: 'invalid_campaign_character' });
  const campaign = await requireCampaignDm(campaignId, req.user.id);
  if (!campaign) return res.status(403).json({ error: 'dm_access_required' });
  const result = await pool.query(
    `SELECT ch.id, ch.name, ch.data, ch.created_at, ch.updated_at,
            u.id AS user_id, u.username, COALESCE(notes.content, '') AS dm_note
     FROM campaign_members cm
     JOIN characters ch ON ch.id = cm.character_id
     JOIN users u ON u.id = cm.user_id
     LEFT JOIN campaign_character_dm_notes notes
       ON notes.campaign_id = cm.campaign_id
      AND notes.dm_user_id = $3
      AND notes.character_id = ch.id
     WHERE cm.campaign_id = $1 AND ch.id = $2`,
    [campaignId, characterId, req.user.id]
  );
  const row = result.rows[0];
  if (!row) return res.status(404).json({ error: 'character_not_found' });
  return res.json({
    ...serializeCharacter(row),
    user: { id: Number(row.user_id), username: row.username },
    dmNote: row.dm_note,
  });
}

async function updateDmNote(req, res) {
  const campaignId = parseId(req.params.id);
  if (!campaignId) return res.status(400).json({ error: 'invalid_campaign_id' });
  if (!await requireCampaignDm(campaignId, req.user.id)) return res.status(403).json({ error: 'dm_access_required' });
  const content = dmNote(req.body?.content);
  await pool.query(
    `INSERT INTO campaign_dm_notes (campaign_id, dm_user_id, content)
     VALUES ($1, $2, $3)
     ON CONFLICT (campaign_id, dm_user_id)
     DO UPDATE SET content = EXCLUDED.content, updated_at = NOW()`,
    [campaignId, req.user.id, content]
  );
  return res.status(204).end();
}

async function updateDmCharacterNote(req, res) {
  const campaignId = parseId(req.params.campaignId);
  const characterId = parseId(req.params.characterId);
  if (!campaignId || !characterId) return res.status(400).json({ error: 'invalid_campaign_character' });
  if (!await requireCampaignDm(campaignId, req.user.id)) return res.status(403).json({ error: 'dm_access_required' });
  const membership = await pool.query(
    'SELECT 1 FROM campaign_members WHERE campaign_id = $1 AND character_id = $2',
    [campaignId, characterId]
  );
  if (!membership.rows[0]) return res.status(404).json({ error: 'character_not_found' });
  const content = dmNote(req.body?.content);
  await pool.query(
    `INSERT INTO campaign_character_dm_notes (campaign_id, dm_user_id, character_id, content)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (campaign_id, dm_user_id, character_id)
     DO UPDATE SET content = EXCLUDED.content, updated_at = NOW()`,
    [campaignId, req.user.id, characterId, content]
  );
  return res.status(204).end();
}

async function addDmCharacterInventoryItem(req, res) {
  const campaignId = parseId(req.params.campaignId);
  const characterId = parseId(req.params.characterId);
  if (!campaignId || !characterId) return res.status(400).json({ error: 'invalid_campaign_character' });
  if (!await requireCampaignDm(campaignId, req.user.id)) return res.status(403).json({ error: 'dm_access_required' });
  const name = String(req.body?.name || '').trim().replace(/\r?\n/g, ' ').slice(0, 150);
  const quantity = Math.max(1, Math.min(9999, Math.trunc(Number(req.body?.quantity) || 1)));
  const duration = String(req.body?.duration || '').trim().replace(/\r?\n/g, ' ').slice(0, 100);
  const icon = /^[a-z_]{1,30}$/.test(req.body?.icon) ? req.body.icon : '';
  if (!name) return res.status(400).json({ error: 'invalid_inventory_item' });

  const result = await pool.query(
    `SELECT ch.data->>'inventory' AS inventory
     FROM campaign_members cm
     JOIN characters ch ON ch.id = cm.character_id
     WHERE cm.campaign_id = $1 AND ch.id = $2`,
    [campaignId, characterId]
  );
  if (!result.rows[0]) return res.status(404).json({ error: 'character_not_found' });
  const line = `${name} × ${quantity}${duration ? ` ⏱ ${duration}` : ''}${icon ? ` [icon=${icon}]` : ''}`;
  const current = String(result.rows[0].inventory || '').trim();
  const inventory = `${current}${current ? '\n' : ''}${line}`.slice(0, 10_000);
  await pool.query(
    `UPDATE characters
     SET data = jsonb_set(COALESCE(data, '{}'::jsonb), '{inventory}', to_jsonb($1::text), true),
         updated_at = NOW()
     WHERE id = $2`,
    [inventory, characterId]
  );
  return res.status(201).json({ inventory });
}

async function getCampaignCharacter(req, res) {
  const campaignId = parseId(req.params.campaignId);
  const characterId = parseId(req.params.characterId);
  if (!campaignId || !characterId) return res.status(400).json({ error: 'invalid_campaign_character' });

  const access = await pool.query(
    `SELECT 1
     FROM campaign_members
     WHERE campaign_id = $1 AND user_id = $2 AND character_id IS NOT NULL`,
    [campaignId, req.user.id]
  );
  if (!access.rows[0]) return res.status(404).json({ error: 'campaign_not_found' });

  const result = await pool.query(
    `SELECT ch.id, ch.name, ch.data, ch.created_at, ch.updated_at, u.id AS user_id, u.username
     FROM campaign_members cm
     JOIN characters ch ON ch.id = cm.character_id
     JOIN users u ON u.id = cm.user_id
     WHERE cm.campaign_id = $1 AND ch.id = $2`,
    [campaignId, characterId]
  );
  const row = result.rows[0];
  if (!row) return res.status(404).json({ error: 'character_not_found' });
  const character = serializeCharacter(row);
  return res.json({
    id: character.id,
    name: character.name,
    avatar: character.avatar,
    motto: character.motto,
    race: character.race,
    classes: character.classes,
    age: character.age,
    height: character.height,
    weight: character.weight,
    level: character.level,
    points: character.points,
    minimumPoints: character.minimumPoints,
    guilds: character.guilds,
    attributes: character.attributes,
    combat: character.combat,
    auxiliary: character.auxiliary,
    skills: character.skills,
    customSkills: character.customSkills,
    special: character.special,
    user: { id: Number(row.user_id), username: row.username },
  });
}

async function leaveCampaign(req, res) {
  const campaignId = parseId(req.params.campaignId);
  const characterId = parseId(req.params.characterId);
  if (!campaignId || !characterId) return res.status(400).json({ error: 'invalid_campaign_character' });
  const result = await pool.query(
    `DELETE FROM campaign_members cm
     USING characters ch
     WHERE cm.campaign_id = $1
       AND cm.character_id = $2
       AND ch.id = cm.character_id
       AND ch.owner_id = $3
     RETURNING cm.campaign_id`,
    [campaignId, characterId, req.user.id]
  );
  if (!result.rows[0]) return res.status(404).json({ error: 'campaign_membership_not_found' });
  return res.status(204).end();
}

module.exports = {
  addDmCharacterInventoryItem,
  createCampaign,
  getDmCharacter,
  getDmPanel,
  inviteToCampaign,
  getCampaignCharacter,
  leaveCampaign,
  listCharacterTeams,
  listCampaignInvitations,
  listOwnedCampaigns,
  respondToCampaignInvitation,
  updateDmCharacterNote,
  updateDmNote,
};
