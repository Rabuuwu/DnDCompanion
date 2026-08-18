const { pool } = require('./db');

const DAY_MS = 86_400_000;
const AUDIT_RETENTION_DAYS = Math.max(7, Number(process.env.AUDIT_RETENTION_DAYS || 90));
const INVITE_RETENTION_DAYS = Math.max(1, Number(process.env.INVITE_RETENTION_DAYS || 30));
const NOTIFICATION_RETENTION_DAYS = Math.max(7, Number(process.env.NOTIFICATION_RETENTION_DAYS || 30));

async function runDatabaseMaintenance() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const lock = await client.query('SELECT pg_try_advisory_xact_lock($1) AS acquired', [20260809]);
    if (!lock.rows[0]?.acquired) {
      await client.query('ROLLBACK');
      return { skipped: true };
    }

    const auditLogs = await client.query(`DELETE FROM audit_logs WHERE created_at < NOW() - ($1 * INTERVAL '1 day')`, [
      AUDIT_RETENTION_DAYS,
    ]);
    const refreshTokens = await client.query(
      `DELETE FROM refresh_tokens WHERE expires_at < NOW() OR revoked_at < NOW() - INTERVAL '7 days'`,
    );
    const friendInvites = await client.query(
      `DELETE FROM friend_invites WHERE expires_at < NOW() - ($1 * INTERVAL '1 day') OR used_at < NOW() - ($1 * INTERVAL '1 day')`,
      [INVITE_RETENTION_DAYS],
    );
    const campaignInvitations = await client.query(
      `DELETE FROM campaign_invitations WHERE status <> 'pending' AND responded_at < NOW() - ($1 * INTERVAL '1 day')`,
      [INVITE_RETENTION_DAYS],
    );
    const campaignContentNotifications = await client.query(
      `DELETE FROM campaign_content_notifications
       WHERE created_at < NOW() - ($1 * INTERVAL '1 day')`,
      [NOTIFICATION_RETENTION_DAYS],
    );
    await client.query('COMMIT');
    return {
      skipped: false,
      deleted: {
        auditLogs: auditLogs.rowCount,
        refreshTokens: refreshTokens.rowCount,
        friendInvites: friendInvites.rowCount,
        campaignInvitations: campaignInvitations.rowCount,
        campaignContentNotifications: campaignContentNotifications.rowCount,
      },
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

function startDatabaseMaintenance() {
  const execute = () =>
    runDatabaseMaintenance()
      .then((result) => console.log('[MAINTENANCE]', JSON.stringify(result)))
      .catch((error) => console.error('[MAINTENANCE] failed:', error.message));
  const initialTimer = setTimeout(execute, 10_000);
  const interval = setInterval(execute, DAY_MS);
  initialTimer.unref();
  interval.unref();
  return () => {
    clearTimeout(initialTimer);
    clearInterval(interval);
  };
}

module.exports = { runDatabaseMaintenance, startDatabaseMaintenance };
