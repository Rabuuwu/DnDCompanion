const { pool } = require('./db');

async function isSessionActive(sessionId, userId) {
  const result = await pool.query(
    `SELECT 1 FROM auth_sessions
     WHERE id=$1 AND user_id=$2 AND revoked_at IS NULL AND expires_at>NOW()`,
    [sessionId, userId],
  );
  return result.rowCount > 0;
}

module.exports = { isSessionActive };
