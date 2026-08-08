const crypto = require('node:crypto');
const { pool } = require('./db');

const ACTIONS = new Map(Object.entries({
  'GET /health': ['connection', 'health_check', 'server'],
  'GET /ready': ['connection', 'readiness_check', 'server'],
  'GET /api/diagnostics/ping': ['connection', 'connection_test', 'server'],
  'GET /api/app/version': ['application', 'version_check', 'application'],
  'GET /api/app/changelog': ['application', 'view_changelog', 'application'],
  'GET /api/app/privacy': ['application', 'view_privacy', 'application'],
  'GET /api/app/help': ['application', 'view_help', 'application'],
  'POST /api/auth/login': ['authentication', 'login', 'user'],
  'POST /api/auth/register': ['authentication', 'register', 'user'],
  'POST /api/auth/refresh': ['authentication', 'refresh_session', 'session'],
  'POST /api/auth/logout': ['authentication', 'logout', 'session'],
  'POST /api/auth/change-password': ['account', 'change_password', 'user'],
  'PUT /api/auth/avatar': ['account', 'change_user_avatar', 'user'],
  'DELETE /api/auth/account': ['account', 'delete_account', 'user'],
  'GET /api/ui-preferences': ['ui', 'load_ui_preferences', 'user_preferences'],
  'PUT /api/ui-preferences': ['ui', 'update_ui_preferences', 'user_preferences'],
  'GET /api/characters': ['character', 'list_characters', 'character'],
  'POST /api/characters': ['character', 'create_character', 'character'],
  'GET /api/characters/:id': ['character', 'view_character', 'character'],
  'PUT /api/characters/:id': ['character', 'update_character', 'character'],
  'PATCH /api/characters/:id/inventory': ['inventory', 'update_inventory', 'character'],
  'PATCH /api/characters/:id/notebook': ['notebook', 'update_notebook', 'character'],
  'DELETE /api/characters/:id': ['character', 'delete_character', 'character'],
  'GET /api/friends': ['friend', 'list_friends', 'friendship'],
  'POST /api/friends/invite': ['friend', 'create_friend_invite', 'friend_invite'],
  'POST /api/friends/accept': ['friend', 'accept_friend_invite', 'friendship'],
  'GET /api/friends/:id/profile': ['friend', 'view_friend_profile', 'user'],
  'GET /api/friends/:id/messages': ['message', 'list_messages', 'conversation'],
  'POST /api/friends/:id/messages': ['message', 'send_message', 'conversation'],
  'DELETE /api/friends/:id': ['friend', 'remove_friend', 'friendship'],
  'PUT /api/friends/:id/nickname': ['friend', 'change_friend_nickname', 'friendship'],
  'POST /api/users/:id/block': ['safety', 'block_user', 'user'],
  'POST /api/users/:id/report': ['safety', 'report_user', 'user'],
  'GET /api/notifications': ['notification', 'list_notifications', 'notification'],
  'GET /api/notifications/stream': ['connection', 'notification_stream', 'notification'],
  'GET /api/campaigns': ['campaign', 'list_campaigns', 'campaign'],
  'POST /api/campaigns': ['campaign', 'create_campaign', 'campaign'],
  'POST /api/campaigns/:id/invitations': ['campaign', 'invite_to_campaign', 'campaign'],
  'GET /api/campaign-invitations': ['campaign', 'list_campaign_invitations', 'campaign_invitation'],
  'POST /api/campaign-invitations/:id/respond': ['campaign', 'respond_to_campaign_invitation', 'campaign_invitation'],
  'GET /api/campaigns/:id/dm': ['campaign_dm', 'open_dm_panel', 'campaign'],
  'PUT /api/campaigns/:id/dm/note': ['campaign_dm', 'update_dm_campaign_note', 'campaign'],
  'GET /api/campaigns/:campaignId/dm/characters/:characterId': ['campaign_dm', 'view_dm_character', 'character'],
  'PUT /api/campaigns/:campaignId/dm/characters/:characterId/note': ['campaign_dm', 'update_dm_character_note', 'character'],
  'POST /api/campaigns/:campaignId/dm/characters/:characterId/inventory': ['campaign_dm', 'add_dm_inventory_item', 'character'],
  'GET /api/characters/:characterId/teams': ['campaign', 'view_character_team', 'character'],
  'GET /api/campaigns/:campaignId/characters/:characterId': ['campaign', 'view_team_character', 'character'],
  'DELETE /api/characters/:characterId/campaigns/:campaignId': ['campaign', 'leave_campaign', 'campaign'],
}));

function safeText(value, maxLength = 200) {
  return String(value ?? '').trim().slice(0, maxLength);
}

function requestMetadata(req, action) {
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const metadata = {};
  const fields = Object.keys(body).filter((key) => ![
    'password', 'currentPassword', 'newPassword', 'token', 'refreshToken', 'avatar',
  ].includes(key));
  if (fields.length) metadata.changedFields = fields.slice(0, 50);

  if (['login', 'register'].includes(action)) metadata.username = safeText(body.username, 50);
  if (action === 'create_character' || action === 'update_character') {
    metadata.characterName = safeText(body.name, 100);
    metadata.inventoryLength = safeText(body.inventory, 10_000).length;
    metadata.guildCount = Array.isArray(body.guilds) ? body.guilds.length : 0;
    metadata.customSkillCount = Array.isArray(body.customSkills) ? body.customSkills.length : 0;
  }
  if (action === 'update_inventory') {
    const inventory = safeText(body.inventory, 10_000);
    metadata.inventoryLength = inventory.length;
    metadata.inventoryLineCount = inventory ? inventory.split(/\r?\n/).length : 0;
  }
  if (action === 'update_notebook') {
    metadata.mode = body.notebook?.mode === 'draw' ? 'draw' : 'text';
    metadata.textLength = String(body.notebook?.text || '').length;
    metadata.strokeCount = Array.isArray(body.notebook?.strokes) ? body.notebook.strokes.length : 0;
  }
  if (action === 'send_message') metadata.messageLength = String(body.message || body.content || '').length;
  if (action === 'change_user_avatar') metadata.avatarChanged = true;
  if (action === 'change_password') metadata.sessionsRevoked = true;
  if (action === 'respond_to_campaign_invitation') metadata.response = safeText(body.action, 20);
  if (action === 'report_user') metadata.reason = safeText(body.reason, 50);
  if (body.friendId !== undefined) metadata.friendId = safeText(body.friendId, 30);
  if (body.characterId !== undefined) metadata.characterId = safeText(body.characterId, 30);
  return metadata;
}

function entityId(req, entityType) {
  if (entityType === 'user' || entityType === 'conversation' || entityType === 'friendship') return req.params?.id || req.user?.id || null;
  if (entityType === 'character') return req.params?.id || req.params?.characterId || null;
  if (entityType === 'campaign') return req.params?.campaignId || req.params?.id || null;
  if (entityType === 'campaign_invitation') return req.params?.id || null;
  return req.params?.id || null;
}

async function writeAuditLog(entry) {
  try {
    await pool.query(
      `INSERT INTO audit_logs (
         request_id, actor_user_id, actor_username, event_type, action,
         entity_type, entity_id, http_method, request_path, status_code,
         success, duration_ms, ip_address, user_agent, metadata
       ) VALUES (
         $1, $2, $3, $4, $5,
         $6, $7, $8, $9, $10,
         $11, $12, NULLIF($13, '')::inet, $14, $15::jsonb
       )`,
      [
        entry.requestId || null,
        entry.actorUserId || null,
        entry.actorUsername || null,
        entry.eventType || 'application',
        entry.action,
        entry.entityType || null,
        entry.entityId == null ? null : String(entry.entityId).slice(0, 100),
        entry.method || null,
        entry.path || null,
        entry.statusCode || null,
        entry.success !== false,
        entry.durationMs ?? null,
        safeText(entry.ipAddress, 100),
        safeText(entry.userAgent, 1000) || null,
        JSON.stringify(entry.metadata || {}),
      ]
    );
  } catch (error) {
    console.error(`[AUDIT] failed action=${entry.action}: ${error.message}`);
  }
}

function auditMiddleware(req, res, next) {
  const startedAt = process.hrtime.bigint();
  const requestId = crypto.randomUUID();
  req.auditRequestId = requestId;
  res.setHeader('X-Request-Id', requestId);

  const originalJson = res.json;
  res.json = function auditedJson(payload) {
    if (payload?.user?.id) req.auditActor = payload.user;
    if (payload?.error) req.auditError = safeText(payload.error, 100);
    return originalJson.call(this, payload);
  };

  res.once('finish', () => {
    const routePath = req.route?.path || req.path;
    const key = `${req.method} ${routePath}`;
    const [eventType, action, entityType] = ACTIONS.get(key) || [
      'http',
      `${req.method.toLowerCase()}_request`,
      'endpoint',
    ];
    const actor = req.user || req.auditActor || {};
    const metadata = requestMetadata(req, action);
    if (req.auditError) metadata.error = req.auditError;
    if (!ACTIONS.has(key)) metadata.route = routePath;

    void writeAuditLog({
      requestId,
      actorUserId: actor.id,
      actorUsername: actor.username,
      eventType,
      action,
      entityType,
      entityId: entityId(req, entityType),
      method: req.method,
      path: req.originalUrl?.split('?')[0] || req.path,
      statusCode: res.statusCode,
      success: res.statusCode < 400,
      durationMs: Number((process.hrtime.bigint() - startedAt) / 1_000_000n),
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      metadata,
    });
  });
  next();
}

module.exports = { auditMiddleware, writeAuditLog };
