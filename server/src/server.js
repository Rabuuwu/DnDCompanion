// API server for Android/iOS clients.

const path = require('node:path');
const crypto = require('node:crypto');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const bodyParser = require('body-parser');
const { rateLimit } = require('express-rate-limit');
const { checkDatabase, pool } = require('./db');
const { auditMiddleware, writeAuditLog } = require('./audit');
const changelog = require('../data/changelog.json');
const privacyPolicy = require('../data/privacy.json');
const helpContent = require('../data/help.json');
const release = require('../../release.json');
const { openapiDocument } = require('./openapi');
const {
  changePassword,
  deleteAccount,
  login,
  logout,
  refresh,
  register,
  requireAuth,
  updateAvatar,
} = require('./auth');
const {
  createCharacter,
  deleteCharacter,
  getCharacter,
  listCharacters,
  updateCharacter,
  updateCharacterInventory,
  updateCharacterNotebook,
} = require('./characters');
const {
  acceptInvite,
  createInvite,
  getFriendProfile,
  listFriends,
  listMessages,
  removeFriend,
  sendMessage,
  setFriendNickname,
} = require('./friends');
const { blockUser, reportUser } = require('./social');
const { listNotifications, stopNotificationListener, streamNotifications } = require('./notifications');
const { getUiPreferences, updateUiPreferences } = require('./preferences');
const { startDatabaseMaintenance } = require('./maintenance');
const {
  addDmCharacterInventoryItem,
  createCampaign,
  getDmCharacter,
  getDmPanel,
  getCampaignCharacter,
  inviteToCampaign,
  leaveCampaign,
  listCharacterTeams,
  listCampaignInvitations,
  listOwnedCampaigns,
  respondToCampaignInvitation,
  updateDmCharacterNote,
  updateDmNote,
} = require('./campaigns');

const app = express();

// Middleware
app.use(helmet());
const allowedOrigins = String(process.env.CORS_ORIGINS || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);
app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
      return callback(new Error('origin_not_allowed'));
    },
  }),
);
app.use(bodyParser.json({ limit: '1mb' }));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(auditMiddleware);

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'too_many_attempts' },
});

// Health check
app.get('/health', (req, res) => res.json({ status: 'ok', uptime: process.uptime() }));
app.get('/openapi.json', (req, res) => res.json(openapiDocument));

app.get('/api/diagnostics/ping', (req, res) => {
  const requestId = crypto.randomUUID();
  const response = {
    ok: true,
    message: 'pong',
    requestId,
    serverTime: new Date().toISOString(),
    client: {
      ip: req.ip,
      origin: req.headers.origin || null,
      userAgent: req.headers['user-agent'] || null,
    },
  };

  console.log(
    `[PING] ${requestId} ip=${response.client.ip} origin=${response.client.origin || '-'} userAgent=${response.client.userAgent || '-'}`,
  );
  res.set('Cache-Control', 'no-store');
  res.json(response);
});

app.get('/ready', async (req, res) => {
  try {
    const database = await checkDatabase();
    res.json({ status: 'ready', database });
  } catch (_error) {
    res.status(503).json({ status: 'not_ready', database: 'unavailable' });
  }
});

app.get('/api/app/version', (req, res) => {
  const androidVersion = release.version;
  const androidUrl = `https://github.com/${release.repository}/releases/download/v${release.version}/DnDCompanion-${release.version}.apk`;
  res.json({
    version: androidVersion,
    android: {
      version: androidVersion,
      url: androidUrl,
    },
    ios: {
      version: process.env.IOS_APP_VERSION || null,
      url: process.env.IOS_DOWNLOAD_URL || null,
    },
    updatedAt: new Date().toISOString(),
  });
});

app.get('/api/app/changelog', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ releases: changelog });
});

app.get('/api/app/privacy', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json(privacyPolicy);
});

app.get('/api/app/help', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json(helpContent);
});

app.post('/api/auth/login', authLimiter, login);
app.post('/api/auth/register', authLimiter, register);
app.post('/api/auth/refresh', authLimiter, refresh);
app.post('/api/auth/logout', logout);
app.post('/api/auth/change-password', authLimiter, requireAuth, changePassword);
app.put('/api/auth/avatar', requireAuth, updateAvatar);
app.delete('/api/auth/account', authLimiter, requireAuth, deleteAccount);

app.get('/api/ui-preferences', requireAuth, getUiPreferences);
app.put('/api/ui-preferences', requireAuth, updateUiPreferences);

app.get('/api/characters', requireAuth, listCharacters);
app.post('/api/characters', requireAuth, createCharacter);
app.get('/api/characters/:id', requireAuth, getCharacter);
app.put('/api/characters/:id', requireAuth, updateCharacter);
app.patch('/api/characters/:id/inventory', requireAuth, updateCharacterInventory);
app.patch('/api/characters/:id/notebook', requireAuth, updateCharacterNotebook);
app.delete('/api/characters/:id', requireAuth, deleteCharacter);

app.get('/api/friends', requireAuth, listFriends);
app.post('/api/friends/invite', authLimiter, requireAuth, createInvite);
app.post('/api/friends/accept', authLimiter, requireAuth, acceptInvite);
app.get('/api/friends/:id/profile', requireAuth, getFriendProfile);
app.get('/api/friends/:id/messages', requireAuth, listMessages);
app.post('/api/friends/:id/messages', requireAuth, sendMessage);
app.delete('/api/friends/:id', requireAuth, removeFriend);
app.put('/api/friends/:id/nickname', requireAuth, setFriendNickname);
app.post('/api/users/:id/block', authLimiter, requireAuth, blockUser);
app.post('/api/users/:id/report', authLimiter, requireAuth, reportUser);
app.get('/api/notifications', requireAuth, listNotifications);
app.get('/api/notifications/stream', requireAuth, streamNotifications);

app.get('/api/campaigns', requireAuth, listOwnedCampaigns);
app.post('/api/campaigns', requireAuth, createCampaign);
app.post('/api/campaigns/:id/invitations', requireAuth, inviteToCampaign);
app.get('/api/campaign-invitations', requireAuth, listCampaignInvitations);
app.post('/api/campaign-invitations/:id/respond', requireAuth, respondToCampaignInvitation);
app.get('/api/campaigns/:id/dm', requireAuth, getDmPanel);
app.put('/api/campaigns/:id/dm/note', requireAuth, updateDmNote);
app.get('/api/campaigns/:campaignId/dm/characters/:characterId', requireAuth, getDmCharacter);
app.put('/api/campaigns/:campaignId/dm/characters/:characterId/note', requireAuth, updateDmCharacterNote);
app.post('/api/campaigns/:campaignId/dm/characters/:characterId/inventory', requireAuth, addDmCharacterInventoryItem);
app.get('/api/characters/:characterId/teams', requireAuth, listCharacterTeams);
app.get('/api/campaigns/:campaignId/characters/:characterId', requireAuth, getCampaignCharacter);
app.delete('/api/characters/:characterId/campaigns/:campaignId', requireAuth, leaveCampaign);

// Global error handler
app.use((err, req, res, _next) => {
  console.error(err && err.stack ? err.stack : err);
  res.status(500).json({ error: 'server_error' });
});

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '127.0.0.1';
const server = app.listen(PORT, HOST, () => {
  console.log(`aplikacja_dnd server listening on ${HOST}:${PORT}`);
  void writeAuditLog({
    eventType: 'system',
    action: 'server_started',
    entityType: 'server',
    success: true,
    metadata: { host: HOST, port: PORT, processId: process.pid },
  });
});
const stopDatabaseMaintenance = startDatabaseMaintenance();

async function shutdown(signal) {
  stopDatabaseMaintenance();
  await stopNotificationListener();
  console.log(`${signal} received, shutting down`);
  await writeAuditLog({
    eventType: 'system',
    action: 'server_stopping',
    entityType: 'server',
    success: true,
    metadata: { signal, processId: process.pid },
  });
  server.close(async () => {
    await pool.end();
    process.exit(0);
  });

  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
