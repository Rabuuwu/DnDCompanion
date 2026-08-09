const { pool } = require('./db');

function parseUserId(value) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

async function blockUser(req, res) {
  const blockedId = parseUserId(req.params.id);
  if (!blockedId) return res.status(400).json({ error: 'invalid_user_id' });
  if (blockedId === req.user.id) return res.status(400).json({ error: 'cannot_block_yourself' });

  const userExists = await pool.query('SELECT 1 FROM users WHERE id = $1', [blockedId]);
  if (userExists.rowCount === 0) return res.status(404).json({ error: 'user_not_found' });

  const lowId = Math.min(req.user.id, blockedId);
  const highId = Math.max(req.user.id, blockedId);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO user_blocks (blocker_id, blocked_id)
       VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
      [req.user.id, blockedId],
    );
    await client.query('DELETE FROM friendships WHERE user_low_id = $1 AND user_high_id = $2', [lowId, highId]);
    await client.query(
      `DELETE FROM friendship_aliases
       WHERE (user_id = $1 AND friend_id = $2)
          OR (user_id = $2 AND friend_id = $1)`,
      [req.user.id, blockedId],
    );
    await client.query(
      `UPDATE friend_invites
       SET used_at = NOW()
       WHERE used_at IS NULL AND owner_id IN ($1, $2)`,
      [req.user.id, blockedId],
    );
    await client.query(
      `UPDATE campaign_invitations
       SET status = 'cancelled', responded_at = NOW()
       WHERE status = 'pending'
         AND ((inviter_id = $1 AND invitee_id = $2)
           OR (inviter_id = $2 AND invitee_id = $1))`,
      [req.user.id, blockedId],
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

async function reportUser(req, res) {
  const reportedId = parseUserId(req.params.id);
  if (!reportedId) return res.status(400).json({ error: 'invalid_user_id' });
  if (reportedId === req.user.id) return res.status(400).json({ error: 'cannot_report_yourself' });

  const allowedReasons = new Set(['spam', 'harassment', 'inappropriate_content', 'impersonation', 'other']);
  const reason = String(req.body?.reason || '');
  const details = String(req.body?.details || '').trim();
  if (!allowedReasons.has(reason) || details.length > 1000) {
    return res.status(400).json({ error: 'invalid_report' });
  }

  const userExists = await pool.query('SELECT 1 FROM users WHERE id = $1', [reportedId]);
  if (userExists.rowCount === 0) return res.status(404).json({ error: 'user_not_found' });

  const result = await pool.query(
    `INSERT INTO user_reports (reporter_id, reported_id, reason, details)
     VALUES ($1, $2, $3, $4)
     RETURNING id, created_at`,
    [req.user.id, reportedId, reason, details],
  );
  return res.status(201).json({
    reportId: Number(result.rows[0].id),
    createdAt: result.rows[0].created_at,
  });
}

module.exports = {
  blockUser,
  reportUser,
};
