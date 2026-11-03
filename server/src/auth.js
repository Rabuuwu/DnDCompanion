const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { pool } = require('./db');
const { isSessionActive } = require('./sessions');

const JWT_SECRET = process.env.JWT_SECRET;
const JWT_ACCESS_TTL = process.env.JWT_ACCESS_TTL || '15m';
const REFRESH_TOKEN_DAYS = Number(process.env.REFRESH_TOKEN_DAYS || 30);
const JWT_ISSUER = 'dnd-api';
const JWT_AUDIENCE = 'dnd-mobile';
const PASSWORD_ROUNDS = 12;
const DUMMY_PASSWORD_HASH = bcrypt.hashSync('not-a-real-user-password', PASSWORD_ROUNDS);

if (!Number.isFinite(REFRESH_TOKEN_DAYS) || REFRESH_TOKEN_DAYS < 1 || REFRESH_TOKEN_DAYS > 90) {
  throw new Error('REFRESH_TOKEN_DAYS must be between 1 and 90');
}

if (!JWT_SECRET || JWT_SECRET.length < 64) {
  throw new Error('JWT_SECRET must contain at least 64 characters');
}

function publicUser(user) {
  return { id: Number(user.id), username: user.username, avatar: user.avatar || '' };
}

function profileImage(value) {
  const image = String(value || '').trim();
  if (!image) return '';
  if (image.length > 700_000) return null;
  return /^data:image\/(?:jpeg|png|webp);base64,[a-z0-9+/=\s]+$/i.test(image) ? image : null;
}

function validNewPassword(password) {
  return password.length >= 8 && !bcrypt.truncates(password);
}

function validateCredentials(username, password, newAccount = false) {
  const normalizedUsername = String(username || '').trim();
  const normalizedPassword = String(password || '');

  if (!/^[A-Za-z0-9_.-]{3,50}$/.test(normalizedUsername)) {
    return { error: 'invalid_username' };
  }

  if (
    normalizedPassword.length < 8 ||
    normalizedPassword.length > 128 ||
    (newAccount && !validNewPassword(normalizedPassword))
  ) {
    return { error: 'invalid_password' };
  }

  return { username: normalizedUsername, password: normalizedPassword };
}

function hashRefreshToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function createAccessToken(user, sessionId) {
  return jwt.sign({ sub: String(user.id), username: user.username, sid: sessionId }, JWT_SECRET, {
    algorithm: 'HS256',
    expiresIn: JWT_ACCESS_TTL,
    issuer: JWT_ISSUER,
    audience: JWT_AUDIENCE,
  });
}

async function createRefreshToken(userId, session, client) {
  const token = crypto.randomBytes(48).toString('base64url');
  const tokenHash = hashRefreshToken(token);
  const expiresAt = session.expiresAt;

  await client.query(
    `INSERT INTO refresh_tokens (user_id, token_hash, expires_at, session_id)
     VALUES ($1, $2, $3, $4)`,
    [userId, tokenHash, expiresAt, session.id],
  );

  return token;
}

async function createSession(user, client, session = null) {
  if (!session) {
    session = { id: crypto.randomUUID(), expiresAt: new Date(Date.now() + REFRESH_TOKEN_DAYS * 86_400_000) };
    // Remove expired/revoked sessions before enforcing the active-session quota.
    await client.query('DELETE FROM auth_sessions WHERE user_id=$1 AND (expires_at<=NOW() OR revoked_at IS NOT NULL)', [
      user.id,
    ]);
    await client.query('INSERT INTO auth_sessions (id,user_id,expires_at) VALUES ($1,$2,$3)', [
      session.id,
      user.id,
      session.expiresAt,
    ]);
  }
  return {
    token: createAccessToken(user, session.id),
    refreshToken: await createRefreshToken(user.id, session, client),
    expiresIn: JWT_ACCESS_TTL,
    user: publicUser(user),
  };
}

async function register(req, res) {
  const credentials = validateCredentials(req.body?.username, req.body?.password, true);
  if (credentials.error) {
    return res.status(400).json({ error: credentials.error });
  }

  const passwordHash = await bcrypt.hash(credentials.password, PASSWORD_ROUNDS);
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    const result = await client.query(
      `INSERT INTO users (username, password_hash)
       VALUES ($1, $2)
       RETURNING id, username, avatar`,
      [credentials.username, passwordHash],
    );
    const session = await createSession(result.rows[0], client);
    await client.query('COMMIT');
    return res.status(201).json(session);
  } catch (error) {
    await client.query('ROLLBACK');
    if (error.code === '23505') {
      return res.status(409).json({ error: 'username_taken' });
    }
    throw error;
  } finally {
    client.release();
  }
}

async function login(req, res) {
  const credentials = validateCredentials(req.body?.username, req.body?.password);
  if (credentials.error) {
    return res.status(401).json({ error: 'invalid_credentials' });
  }

  const result = await pool.query(
    `SELECT id, username, avatar, password_hash
     FROM users
     WHERE LOWER(username) = LOWER($1)`,
    [credentials.username],
  );
  const user = result.rows[0];
  const validPassword = await bcrypt.compare(credentials.password, user?.password_hash || DUMMY_PASSWORD_HASH);

  if (!user || !validPassword) {
    return res.status(401).json({ error: 'invalid_credentials' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const locked = await client.query('SELECT password_hash FROM users WHERE id=$1 FOR UPDATE', [user.id]);
    if (locked.rows[0]?.password_hash !== user.password_hash) {
      await client.query('ROLLBACK');
      return res.status(401).json({ error: 'invalid_credentials' });
    }
    const session = await createSession(user, client);
    await client.query('COMMIT');
    return res.json(session);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function refresh(req, res) {
  const refreshToken = String(req.body?.refreshToken || '');
  if (!refreshToken) {
    return res.status(401).json({ error: 'invalid_refresh_token' });
  }

  const tokenHash = hashRefreshToken(refreshToken);
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    // Use the same user-first lock order as login/password changes/deletion.
    await client.query(
      `SELECT u.id FROM users u JOIN refresh_tokens rt ON rt.user_id=u.id
                        WHERE rt.token_hash=$1 FOR UPDATE OF u`,
      [tokenHash],
    );
    const result = await client.query(
      `SELECT rt.id, rt.user_id, rt.expires_at, rt.revoked_at, rt.session_id, u.username, u.avatar
       FROM refresh_tokens rt
       JOIN users u ON u.id = rt.user_id
       WHERE rt.token_hash = $1
       FOR UPDATE`,
      [tokenHash],
    );
    const storedToken = result.rows[0];

    const sessionState = storedToken?.session_id
      ? await client.query(
          'SELECT expires_at FROM auth_sessions WHERE id=$1 AND user_id=$2 AND revoked_at IS NULL AND expires_at>NOW()',
          [storedToken.session_id, storedToken.user_id],
        )
      : { rows: [] };
    if (
      !storedToken ||
      storedToken.revoked_at ||
      new Date(storedToken.expires_at) <= new Date() ||
      !sessionState.rows[0]
    ) {
      await client.query('ROLLBACK');
      return res.status(401).json({ error: 'invalid_refresh_token' });
    }

    await client.query('UPDATE refresh_tokens SET revoked_at = NOW() WHERE id = $1', [storedToken.id]);
    const session = await createSession(
      { id: storedToken.user_id, username: storedToken.username, avatar: storedToken.avatar },
      client,
      { id: storedToken.session_id, expiresAt: sessionState.rows[0].expires_at },
    );
    await client.query('COMMIT');
    return res.json(session);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function logout(req, res) {
  const refreshToken = String(req.body?.refreshToken || '');
  if (refreshToken) {
    await pool.query(
      `WITH revoked AS (
         UPDATE auth_sessions SET revoked_at=COALESCE(revoked_at,NOW())
         WHERE id=(SELECT session_id FROM refresh_tokens WHERE token_hash=$1)
         RETURNING id,user_id
       ) SELECT pg_notify('dnd_user_notifications',json_build_object(
         'userId',user_id,'event',json_build_object('type','session_revoked','sessionId',id))::text)
         FROM revoked`,
      [hashRefreshToken(refreshToken)],
    );
  }
  return res.status(204).end();
}

async function changePassword(req, res) {
  const currentPassword = String(req.body?.currentPassword || '');
  const newPassword = String(req.body?.newPassword || '');

  if (!validNewPassword(newPassword)) {
    return res.status(400).json({ error: 'invalid_new_password' });
  }
  if (currentPassword === newPassword) {
    return res.status(400).json({ error: 'password_unchanged' });
  }

  const result = await pool.query('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
  const user = result.rows[0];
  if (!user || !(await bcrypt.compare(currentPassword, user.password_hash))) {
    return res.status(401).json({ error: 'invalid_current_password' });
  }

  const passwordHash = await bcrypt.hash(newPassword, PASSWORD_ROUNDS);
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    const locked = await client.query('SELECT password_hash FROM users WHERE id=$1 FOR UPDATE', [req.user.id]);
    if (locked.rows[0]?.password_hash !== user.password_hash) {
      await client.query('ROLLBACK');
      return res.status(401).json({ error: 'invalid_current_password' });
    }
    await client.query('UPDATE auth_sessions SET revoked_at=COALESCE(revoked_at,NOW()) WHERE user_id=$1', [
      req.user.id,
    ]);
    await client.query(
      `UPDATE users
       SET password_hash = $1, updated_at = NOW()
       WHERE id = $2`,
      [passwordHash, req.user.id],
    );
    await client.query(
      `UPDATE refresh_tokens
       SET revoked_at = COALESCE(revoked_at, NOW())
       WHERE user_id = $1`,
      [req.user.id],
    );
    await client.query(
      `SELECT pg_notify('dnd_user_notifications',json_build_object(
      'userId',$1::bigint,'event',json_build_object('type','session_revoked'))::text)`,
      [req.user.id],
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

async function deleteAccount(req, res) {
  const password = String(req.body?.password || '');
  const result = await pool.query('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
  const user = result.rows[0];

  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    return res.status(401).json({ error: 'invalid_current_password' });
  }

  // Compare the verified hash again atomically: a concurrent password change wins.
  const deleted = await pool.query(
    `WITH deleted AS (DELETE FROM users WHERE id=$1 AND password_hash=$2 RETURNING id)
     SELECT id,pg_notify('dnd_user_notifications',json_build_object(
       'userId',id,'event',json_build_object('type','session_revoked'))::text) FROM deleted`,
    [req.user.id, user.password_hash],
  );
  if (!deleted.rowCount) return res.status(401).json({ error: 'invalid_current_password' });
  return res.status(204).end();
}

async function updateAvatar(req, res) {
  const avatar = profileImage(req.body?.avatar);
  if (avatar === null) {
    return res.status(400).json({ error: 'invalid_avatar' });
  }
  const result = await pool.query(
    `UPDATE users
     SET avatar = $1, updated_at = NOW()
     WHERE id = $2
     RETURNING id, username, avatar`,
    [avatar, req.user.id],
  );
  return res.json(publicUser(result.rows[0]));
}

async function requireAuth(req, res, next) {
  const [scheme, token] = String(req.headers.authorization || '').split(' ');
  if (scheme !== 'Bearer' || !token) return res.status(401).json({ error: 'unauthorized' });
  let payload;
  try {
    payload = jwt.verify(token, JWT_SECRET, {
      algorithms: ['HS256'],
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
    });
  } catch {
    return res.status(401).json({ error: 'unauthorized' });
  }
  const userId = Number(payload.sub);
  if (
    !Number.isSafeInteger(userId) ||
    userId < 1 ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(payload.sid || '') ||
    !Number.isFinite(payload.exp)
  )
    return res.status(401).json({ error: 'unauthorized' });
  if (!(await isSessionActive(payload.sid, userId))) return res.status(401).json({ error: 'unauthorized' });
  req.user = { id: userId, username: payload.username };
  req.auth = { sessionId: payload.sid, expiresAt: payload.exp * 1000 };
  res.set('Cache-Control', 'no-store');
  return next();
}

module.exports = {
  changePassword,
  deleteAccount,
  login,
  logout,
  refresh,
  register,
  requireAuth,
  updateAvatar,
};
