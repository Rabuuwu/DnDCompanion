const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { pool } = require('./db');

const JWT_SECRET = process.env.JWT_SECRET;
const JWT_ACCESS_TTL = process.env.JWT_ACCESS_TTL || '15m';
const REFRESH_TOKEN_DAYS = Number(process.env.REFRESH_TOKEN_DAYS || 30);
const JWT_ISSUER = 'dnd-api';
const JWT_AUDIENCE = 'dnd-mobile';
const PASSWORD_ROUNDS = 12;
const DUMMY_PASSWORD_HASH = bcrypt.hashSync('not-a-real-user-password', PASSWORD_ROUNDS);

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
  return /^data:image\/(?:jpeg|png|webp);base64,[a-z0-9+/=\s]+$/i.test(image)
    ? image
    : null;
}

function validateCredentials(username, password) {
  const normalizedUsername = String(username || '').trim();
  const normalizedPassword = String(password || '');

  if (!/^[A-Za-z0-9_.-]{3,50}$/.test(normalizedUsername)) {
    return { error: 'invalid_username' };
  }

  if (normalizedPassword.length < 8 || normalizedPassword.length > 128) {
    return { error: 'invalid_password' };
  }

  return { username: normalizedUsername, password: normalizedPassword };
}

function hashRefreshToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function createAccessToken(user) {
  return jwt.sign(
    { sub: String(user.id), username: user.username },
    JWT_SECRET,
    {
      algorithm: 'HS256',
      expiresIn: JWT_ACCESS_TTL,
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
    }
  );
}

async function createRefreshToken(userId, client = pool) {
  const token = crypto.randomBytes(48).toString('base64url');
  const tokenHash = hashRefreshToken(token);
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_DAYS * 86_400_000);

  await client.query(
    `INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
     VALUES ($1, $2, $3)`,
    [userId, tokenHash, expiresAt]
  );

  return token;
}

async function createSession(user, client = pool) {
  return {
    token: createAccessToken(user),
    refreshToken: await createRefreshToken(user.id, client),
    expiresIn: JWT_ACCESS_TTL,
    user: publicUser(user),
  };
}

async function register(req, res) {
  const credentials = validateCredentials(req.body?.username, req.body?.password);
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
      [credentials.username, passwordHash]
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
    [credentials.username]
  );
  const user = result.rows[0];
  const validPassword = await bcrypt.compare(
    credentials.password,
    user?.password_hash || DUMMY_PASSWORD_HASH
  );

  if (!user || !validPassword) {
    return res.status(401).json({ error: 'invalid_credentials' });
  }

  return res.json(await createSession(user));
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
    const result = await client.query(
      `SELECT rt.id, rt.user_id, rt.expires_at, rt.revoked_at, u.username, u.avatar
       FROM refresh_tokens rt
       JOIN users u ON u.id = rt.user_id
       WHERE rt.token_hash = $1
       FOR UPDATE`,
      [tokenHash]
    );
    const storedToken = result.rows[0];

    if (
      !storedToken ||
      storedToken.revoked_at ||
      new Date(storedToken.expires_at) <= new Date()
    ) {
      await client.query('ROLLBACK');
      return res.status(401).json({ error: 'invalid_refresh_token' });
    }

    await client.query(
      'UPDATE refresh_tokens SET revoked_at = NOW() WHERE id = $1',
      [storedToken.id]
    );
    const session = await createSession(
      { id: storedToken.user_id, username: storedToken.username, avatar: storedToken.avatar },
      client
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
      `UPDATE refresh_tokens
       SET revoked_at = COALESCE(revoked_at, NOW())
       WHERE token_hash = $1`,
      [hashRefreshToken(refreshToken)]
    );
  }
  return res.status(204).end();
}

async function changePassword(req, res) {
  const currentPassword = String(req.body?.currentPassword || '');
  const newPassword = String(req.body?.newPassword || '');

  if (newPassword.length < 8 || newPassword.length > 128) {
    return res.status(400).json({ error: 'invalid_new_password' });
  }
  if (currentPassword === newPassword) {
    return res.status(400).json({ error: 'password_unchanged' });
  }

  const result = await pool.query(
    'SELECT password_hash FROM users WHERE id = $1',
    [req.user.id]
  );
  const user = result.rows[0];
  if (!user || !(await bcrypt.compare(currentPassword, user.password_hash))) {
    return res.status(401).json({ error: 'invalid_current_password' });
  }

  const passwordHash = await bcrypt.hash(newPassword, PASSWORD_ROUNDS);
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE users
       SET password_hash = $1, updated_at = NOW()
       WHERE id = $2`,
      [passwordHash, req.user.id]
    );
    await client.query(
      `UPDATE refresh_tokens
       SET revoked_at = COALESCE(revoked_at, NOW())
       WHERE user_id = $1`,
      [req.user.id]
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
  const result = await pool.query(
    'SELECT password_hash FROM users WHERE id = $1',
    [req.user.id]
  );
  const user = result.rows[0];

  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    return res.status(401).json({ error: 'invalid_current_password' });
  }

  await pool.query('DELETE FROM users WHERE id = $1', [req.user.id]);
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
    [avatar, req.user.id]
  );
  return res.json(publicUser(result.rows[0]));
}

function requireAuth(req, res, next) {
  const authorization = req.headers.authorization || '';
  const [scheme, token] = authorization.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET, {
      algorithms: ['HS256'],
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
    });
    req.user = { id: Number(payload.sub), username: payload.username };
    return next();
  } catch {
    return res.status(401).json({ error: 'unauthorized' });
  }
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
