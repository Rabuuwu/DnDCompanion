const crypto = require('node:crypto');
const { pool } = require('./db');
const { publishUserNotification } = require('./notifications');

const INVITE_TTL_MINUTES = 15;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function normalizeCode(value) {
  return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function hashCode(code) {
  return crypto.createHash('sha256').update(code).digest('hex');
}

function generateCode(length = 8) {
  let code = '';
  for (let index = 0; index < length; index += 1) {
    code += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
  }
  return code;
}

function parseUserId(value) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

async function areFriends(firstUserId, secondUserId, client = pool) {
  const lowId = Math.min(firstUserId, secondUserId);
  const highId = Math.max(firstUserId, secondUserId);
  const result = await client.query(
    `SELECT created_at
     FROM friendships
     WHERE user_low_id = $1 AND user_high_id = $2`,
    [lowId, highId]
  );
  return result.rows[0] || null;
}

async function areBlocked(firstUserId, secondUserId, client = pool) {
  const result = await client.query(
    `SELECT 1
     FROM user_blocks
     WHERE (blocker_id = $1 AND blocked_id = $2)
        OR (blocker_id = $2 AND blocked_id = $1)`,
    [firstUserId, secondUserId]
  );
  return result.rowCount > 0;
}

async function listFriends(req, res) {
  const result = await pool.query(
    `SELECT u.id, u.username, u.avatar, a.nickname, f.created_at
     FROM friendships f
     JOIN users u
       ON u.id = CASE
         WHEN f.user_low_id = $1 THEN f.user_high_id
         ELSE f.user_low_id
     END
     LEFT JOIN friendship_aliases a
       ON a.user_id = $1 AND a.friend_id = u.id
     WHERE f.user_low_id = $1 OR f.user_high_id = $1
     ORDER BY LOWER(u.username), u.id`,
    [req.user.id]
  );

  return res.json(result.rows.map((friend) => ({
    id: Number(friend.id),
    username: friend.username,
    avatar: friend.avatar || '',
    nickname: friend.nickname,
    friendsSince: friend.created_at,
  })));
}

async function createInvite(req, res) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE friend_invites
       SET used_at = NOW()
       WHERE owner_id = $1 AND used_at IS NULL`,
      [req.user.id]
    );

    let code;
    let inserted = false;
    for (let attempt = 0; attempt < 5 && !inserted; attempt += 1) {
      code = generateCode();
      const result = await client.query(
        `INSERT INTO friend_invites (owner_id, code_hash, expires_at)
         VALUES ($1, $2, NOW() + ($3 * INTERVAL '1 minute'))
         ON CONFLICT (code_hash) DO NOTHING
         RETURNING expires_at`,
        [req.user.id, hashCode(code), INVITE_TTL_MINUTES]
      );
      inserted = result.rowCount === 1;
    }

    if (!inserted) throw new Error('invite_generation_failed');
    await client.query('COMMIT');
    return res.status(201).json({
      code,
      expiresInMinutes: INVITE_TTL_MINUTES,
    });
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function acceptInvite(req, res) {
  const code = normalizeCode(req.body?.code);
  if (code.length !== 8) {
    return res.status(400).json({ error: 'invalid_invite_code' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const inviteResult = await client.query(
      `SELECT fi.id, fi.owner_id, u.username, u.avatar
       FROM friend_invites fi
       JOIN users u ON u.id = fi.owner_id
       WHERE fi.code_hash = $1
         AND fi.used_at IS NULL
         AND fi.expires_at > NOW()
       FOR UPDATE`,
      [hashCode(code)]
    );
    const invite = inviteResult.rows[0];

    if (!invite) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'invite_not_found_or_expired' });
    }
    if (Number(invite.owner_id) === req.user.id) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'cannot_add_yourself' });
    }
    if (await areBlocked(req.user.id, Number(invite.owner_id), client)) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'user_blocked' });
    }

    const lowId = Math.min(req.user.id, Number(invite.owner_id));
    const highId = Math.max(req.user.id, Number(invite.owner_id));
    const friendship = await client.query(
      `INSERT INTO friendships (user_low_id, user_high_id)
       VALUES ($1, $2)
       ON CONFLICT (user_low_id, user_high_id) DO NOTHING
       RETURNING created_at`,
      [lowId, highId]
    );

    await client.query(
      `UPDATE friend_invites
       SET used_at = NOW(), used_by = $1
       WHERE id = $2`,
      [req.user.id, invite.id]
    );
    await client.query('COMMIT');

    if (friendship.rowCount === 0) {
      return res.status(409).json({ error: 'already_friends' });
    }
    return res.status(201).json({
      friend: {
        id: Number(invite.owner_id),
        username: invite.username,
        avatar: invite.avatar || '',
        friendsSince: friendship.rows[0].created_at,
      },
    });
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function getFriendProfile(req, res) {
  const friendId = parseUserId(req.params.id);
  if (!friendId) return res.status(400).json({ error: 'invalid_friend_id' });

  const friendship = await areFriends(req.user.id, friendId);
  if (!friendship) return res.status(404).json({ error: 'friend_not_found' });

  const result = await pool.query(
    `SELECT u.id, u.username, u.avatar, u.created_at, COUNT(c.id)::int AS character_count
     FROM users u
     LEFT JOIN characters c ON c.owner_id = u.id
     WHERE u.id = $1
     GROUP BY u.id`,
    [friendId]
  );
  const friend = result.rows[0];
  if (!friend) return res.status(404).json({ error: 'friend_not_found' });

  return res.json({
    id: Number(friend.id),
    username: friend.username,
    avatar: friend.avatar || '',
    memberSince: friend.created_at,
    friendsSince: friendship.created_at,
    characterCount: friend.character_count,
  });
}

async function listMessages(req, res) {
  const friendId = parseUserId(req.params.id);
  if (!friendId) return res.status(400).json({ error: 'invalid_friend_id' });
  if (!(await areFriends(req.user.id, friendId))) {
    return res.status(404).json({ error: 'friend_not_found' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE direct_messages
       SET read_at = NOW()
       WHERE sender_id = $1 AND recipient_id = $2 AND read_at IS NULL`,
      [friendId, req.user.id]
    );
    const result = await client.query(
      `SELECT *
       FROM (
         SELECT id, sender_id, recipient_id, body, read_at, created_at
         FROM direct_messages
         WHERE (sender_id = $1 AND recipient_id = $2)
            OR (sender_id = $2 AND recipient_id = $1)
         ORDER BY created_at DESC, id DESC
         LIMIT 100
       ) recent
       ORDER BY created_at ASC, id ASC`,
      [req.user.id, friendId]
    );
    await client.query('COMMIT');

    return res.json(result.rows.map((message) => ({
      id: Number(message.id),
      body: message.body,
      sentByMe: Number(message.sender_id) === req.user.id,
      readAt: message.read_at,
      createdAt: message.created_at,
    })));
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function sendMessage(req, res) {
  const friendId = parseUserId(req.params.id);
  if (!friendId) return res.status(400).json({ error: 'invalid_friend_id' });
  if (!(await areFriends(req.user.id, friendId))) {
    return res.status(404).json({ error: 'friend_not_found' });
  }

  const body = String(req.body?.body || '').trim();
  if (!body || body.length > 2000) {
    return res.status(400).json({ error: 'invalid_message' });
  }

  const result = await pool.query(
    `INSERT INTO direct_messages (sender_id, recipient_id, body)
     VALUES ($1, $2, $3)
     RETURNING id, body, read_at, created_at`,
    [req.user.id, friendId, body]
  );
  const message = result.rows[0];
  publishUserNotification(friendId, {
    type: 'message',
    messageId: Number(message.id),
    senderId: req.user.id,
  });
  return res.status(201).json({
    id: Number(message.id),
    body: message.body,
    sentByMe: true,
    readAt: message.read_at,
    createdAt: message.created_at,
  });
}

async function removeFriend(req, res) {
  const friendId = parseUserId(req.params.id);
  if (!friendId) return res.status(400).json({ error: 'invalid_friend_id' });
  const lowId = Math.min(req.user.id, friendId);
  const highId = Math.max(req.user.id, friendId);
  const result = await pool.query(
    `DELETE FROM friendships
     WHERE user_low_id = $1 AND user_high_id = $2
     RETURNING user_low_id`,
    [lowId, highId]
  );
  if (result.rowCount === 0) return res.status(404).json({ error: 'friend_not_found' });
  return res.status(204).end();
}

async function setFriendNickname(req, res) {
  const friendId = parseUserId(req.params.id);
  if (!friendId) return res.status(400).json({ error: 'invalid_friend_id' });
  if (!(await areFriends(req.user.id, friendId))) {
    return res.status(404).json({ error: 'friend_not_found' });
  }
  const nickname = String(req.body?.nickname || '').trim();
  if (nickname.length > 50) return res.status(400).json({ error: 'invalid_nickname' });

  if (!nickname) {
    await pool.query(
      'DELETE FROM friendship_aliases WHERE user_id = $1 AND friend_id = $2',
      [req.user.id, friendId]
    );
    return res.json({ nickname: null });
  }

  await pool.query(
    `INSERT INTO friendship_aliases (user_id, friend_id, nickname)
     VALUES ($1, $2, $3)
     ON CONFLICT (user_id, friend_id)
     DO UPDATE SET nickname = EXCLUDED.nickname, updated_at = NOW()`,
    [req.user.id, friendId, nickname]
  );
  return res.json({ nickname });
}

module.exports = {
  acceptInvite,
  createInvite,
  getFriendProfile,
  listFriends,
  listMessages,
  removeFriend,
  sendMessage,
  setFriendNickname,
};
