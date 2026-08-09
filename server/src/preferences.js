const { pool } = require('./db');

function normalizePreferences(value) {
  const source = value && typeof value === 'object' ? value : {};
  const collapsedSource =
    source.collapsedSections && typeof source.collapsedSections === 'object' ? source.collapsedSections : {};
  const collapsedSections = {};
  for (const [key, collapsed] of Object.entries(collapsedSource).slice(0, 200)) {
    if (/^[a-z0-9._-]{1,100}$/i.test(key) && typeof collapsed === 'boolean') {
      collapsedSections[key] = collapsed;
    }
  }
  return { collapsedSections };
}

async function getUiPreferences(req, res) {
  const result = await pool.query('SELECT settings, updated_at FROM user_ui_preferences WHERE user_id = $1', [
    req.user.id,
  ]);
  const row = result.rows[0];
  return res.json({
    settings: normalizePreferences(row?.settings),
    updatedAt: row?.updated_at || null,
  });
}

async function updateUiPreferences(req, res) {
  const settings = normalizePreferences(req.body?.settings);
  const result = await pool.query(
    `INSERT INTO user_ui_preferences (user_id, settings)
     VALUES ($1, $2::jsonb)
     ON CONFLICT (user_id)
     DO UPDATE SET settings = EXCLUDED.settings, updated_at = NOW()
     RETURNING settings, updated_at`,
    [req.user.id, JSON.stringify(settings)],
  );
  return res.json({
    settings: normalizePreferences(result.rows[0].settings),
    updatedAt: result.rows[0].updated_at,
  });
}

module.exports = { getUiPreferences, updateUiPreferences };
