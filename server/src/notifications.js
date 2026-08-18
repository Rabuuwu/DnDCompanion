const { pool } = require('./db');

const notificationStreams = new Map();
const NOTIFICATION_CHANNEL = 'dnd_user_notifications';
let listenerClient = null;
let listenerReconnectTimer = null;

function deliverUserNotification(userId, event) {
  const streams = notificationStreams.get(Number(userId));
  if (!streams) return;
  const payload = `data: ${JSON.stringify(event)}\n\n`;
  for (const response of streams) response.write(payload);
}

async function connectNotificationListener() {
  if (listenerClient) return;
  try {
    const client = await pool.connect();
    listenerClient = client;
    client.on('notification', (message) => {
      if (message.channel !== NOTIFICATION_CHANNEL || !message.payload) return;
      try {
        const payload = JSON.parse(message.payload);
        deliverUserNotification(payload.userId, payload.event);
      } catch (error) {
        console.error('[NOTIFICATIONS] invalid database event:', error.message);
      }
    });
    client.on('error', (error) => {
      console.error('[NOTIFICATIONS] listener disconnected:', error.message);
      if (listenerClient === client) listenerClient = null;
      try {
        client.release(true);
      } catch {}
      scheduleNotificationReconnect();
    });
    await client.query(`LISTEN ${NOTIFICATION_CHANNEL}`);
    console.log('[NOTIFICATIONS] PostgreSQL listener connected');
  } catch (error) {
    listenerClient = null;
    console.error('[NOTIFICATIONS] listener connection failed:', error.message);
    scheduleNotificationReconnect();
  }
}

function scheduleNotificationReconnect() {
  if (listenerReconnectTimer) return;
  listenerReconnectTimer = setTimeout(() => {
    listenerReconnectTimer = null;
    void connectNotificationListener();
  }, 5_000);
  listenerReconnectTimer.unref();
}

async function stopNotificationListener() {
  if (listenerReconnectTimer) {
    clearTimeout(listenerReconnectTimer);
    listenerReconnectTimer = null;
  }
  const client = listenerClient;
  listenerClient = null;
  if (!client) return;
  client.removeAllListeners('notification');
  client.removeAllListeners('error');
  try {
    await client.query(`UNLISTEN ${NOTIFICATION_CHANNEL}`);
  } catch {}
  client.release();
}

function publishUserNotification(userId, event = {}) {
  const payload = JSON.stringify({ userId: Number(userId), event });
  void pool.query('SELECT pg_notify($1, $2)', [NOTIFICATION_CHANNEL, payload]).catch((error) => {
    console.error('[NOTIFICATIONS] publish failed:', error.message);
    deliverUserNotification(userId, event);
  });
}

void connectNotificationListener();

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
  const [messagesResult, contentResult, invitationsResult] = await Promise.all([
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
      [req.user.id],
    ),
    pool.query(
      `SELECT notification.id,notification.campaign_id,notification.notification_type,
              notification.entity_id,notification.title,notification.created_at,campaign.name AS campaign_name
       FROM campaign_content_notifications notification
       JOIN campaigns campaign ON campaign.id=notification.campaign_id
       WHERE notification.user_id=$1 AND notification.read_at IS NULL
       ORDER BY notification.created_at ASC,notification.id ASC LIMIT 50`,
      [req.user.id],
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
      [req.user.id],
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
    campaignContent: contentResult.rows.map((notification) => ({
      id: Number(notification.id),
      type: notification.notification_type,
      entityId: Number(notification.entity_id),
      campaign: { id: Number(notification.campaign_id), name: notification.campaign_name },
      title: notification.title,
      createdAt: notification.created_at,
    })),
  });
}

async function readCampaignContentNotification(req, res) {
  const notificationId = Number(req.params.id);
  if (!Number.isSafeInteger(notificationId) || notificationId < 1) {
    return res.status(400).json({ error: 'invalid_notification_id' });
  }
  const result = await pool.query(
    `UPDATE campaign_content_notifications SET read_at=COALESCE(read_at,NOW())
     WHERE id=$1 AND user_id=$2 RETURNING id`,
    [notificationId, req.user.id],
  );
  if (!result.rows[0]) return res.status(404).json({ error: 'notification_not_found' });
  return res.status(204).end();
}

module.exports = {
  listNotifications,
  publishUserNotification,
  readCampaignContentNotification,
  stopNotificationListener,
  streamNotifications,
};
