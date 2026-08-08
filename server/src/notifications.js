const { pool } = require('./db');

const notificationStreams = new Map();

function publishUserNotification(userId, event = {}) {
  const streams = notificationStreams.get(Number(userId));
  if (!streams) return;
  const payload = `data: ${JSON.stringify(event)}\n\n`;
  for (const response of streams) response.write(payload);
}

function streamNotifications(req, res) {
  const userId = Number(req.user.id);
  res.status(200);
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();
  res.write('event: connected\ndata: {}\n\n');

  const streams = notificationStreams.get(userId) || new Set();
  streams.add(res);
  notificationStreams.set(userId, streams);
  const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 20_000);

  req.on('close', () => {
    clearInterval(heartbeat);
    streams.delete(res);
    if (streams.size === 0) notificationStreams.delete(userId);
  });
}

async function listNotifications(req, res) {
  const [messagesResult, invitationsResult] = await Promise.all([
    pool.query(
      `SELECT dm.id, dm.body, dm.created_at,
              sender.id AS sender_id, sender.username, sender.avatar,
              aliases.nickname
       FROM direct_messages dm
       JOIN users sender ON sender.id = dm.sender_id
       LEFT JOIN friendship_aliases aliases
         ON aliases.user_id = dm.recipient_id
        AND aliases.friend_id = dm.sender_id
       WHERE dm.recipient_id = $1
         AND dm.read_at IS NULL
       ORDER BY dm.created_at ASC, dm.id ASC
       LIMIT 50`,
      [req.user.id]
    ),
    pool.query(
      `SELECT ci.id, ci.created_at,
              c.id AS campaign_id, c.name AS campaign_name,
              inviter.id AS inviter_id, inviter.username AS inviter_username,
              inviter.avatar AS inviter_avatar
       FROM campaign_invitations ci
       JOIN campaigns c ON c.id = ci.campaign_id
       JOIN users inviter ON inviter.id = ci.inviter_id
       WHERE ci.invitee_id = $1
         AND ci.status = 'pending'
       ORDER BY ci.created_at ASC, ci.id ASC
       LIMIT 50`,
      [req.user.id]
    ),
  ]);

  return res.json({
    messages: messagesResult.rows.map((message) => ({
      id: Number(message.id),
      body: message.body,
      sender: {
        id: Number(message.sender_id),
        username: message.username,
        avatar: message.avatar || '',
        nickname: message.nickname,
      },
      createdAt: message.created_at,
    })),
    campaignInvitations: invitationsResult.rows.map((invitation) => ({
      id: Number(invitation.id),
      campaign: {
        id: Number(invitation.campaign_id),
        name: invitation.campaign_name,
      },
      inviter: {
        id: Number(invitation.inviter_id),
        username: invitation.inviter_username,
        avatar: invitation.inviter_avatar || '',
      },
      createdAt: invitation.created_at,
    })),
  });
}

module.exports = { listNotifications, publishUserNotification, streamNotifications };
