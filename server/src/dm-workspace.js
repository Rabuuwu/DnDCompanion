const { pool } = require('./db');
const { publishUserNotification } = require('./notifications');

const ENTITY_CONFIG = {
  npcs: {
    table: 'campaign_npcs',
    labelColumn: 'name',
    statuses: ['active', 'missing', 'dead', 'unknown'],
    extra: ['portrait'],
  },
  locations: {
    table: 'campaign_locations',
    labelColumn: 'name',
    statuses: [],
    extra: ['parent_id', 'location_type', 'illustration'],
  },
  factions: {
    table: 'campaign_factions',
    labelColumn: 'name',
    statuses: [],
    extra: ['symbol', 'attitude'],
  },
  quests: {
    table: 'campaign_quests',
    labelColumn: 'name',
    statuses: ['prepared', 'available', 'active', 'paused', 'completed', 'failed', 'hidden'],
    extra: ['started_session_id', 'completed_session_id'],
  },
  threads: {
    table: 'campaign_story_threads',
    labelColumn: 'title',
    statuses: ['idea', 'prepared', 'active', 'paused', 'resolved', 'abandoned'],
    extra: ['priority'],
  },
};

const VISIBILITIES = new Set(['dm', 'party', 'selected']);

function parseId(value) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function text(value, max = 10_000) {
  return String(value || '')
    .trim()
    .slice(0, max);
}

function optionalText(value, max = 10_000) {
  return String(value || '').slice(0, max);
}

function jsonValue(value, fallback) {
  try {
    const serialized = JSON.stringify(value ?? fallback);
    if (serialized.length > 50_000) return fallback;
    return JSON.parse(serialized);
  } catch {
    return fallback;
  }
}

function jsonArray(value) {
  const parsed = jsonValue(value, []);
  return Array.isArray(parsed) ? parsed : [];
}

function pagination(query) {
  const requestedLimit = Number(query.limit || 50);
  const requestedOffset = Number(query.offset || 0);
  return {
    limit: Number.isSafeInteger(requestedLimit) ? Math.max(1, Math.min(100, requestedLimit)) : 50,
    offset: Number.isSafeInteger(requestedOffset) ? Math.max(0, Math.min(100_000, requestedOffset)) : 0,
  };
}

async function requireDm(campaignId, userId, client = pool) {
  const result = await client.query(
    `SELECT c.id, c.name, c.owner_id, c.description, c.image, c.created_at, c.archived_at,
            CASE WHEN c.owner_id = $2 THEN 'owner' ELSE cm.role END AS role
     FROM campaigns c
     LEFT JOIN campaign_members cm ON cm.campaign_id = c.id AND cm.user_id = $2
     WHERE c.id = $1
       AND c.archived_at IS NULL
       AND (c.owner_id = $2 OR cm.role = 'co_dm')`,
    [campaignId, userId],
  );
  return result.rows[0] || null;
}

function requireCampaignId(req, res) {
  const campaignId = parseId(req.params.campaignId || req.params.id);
  if (!campaignId) res.status(400).json({ error: 'invalid_campaign_id' });
  return campaignId;
}

async function listDmNotes(req, res) {
  const campaignId = requireCampaignId(req, res);
  if (!campaignId) return;
  if (!(await requireDm(campaignId, req.user.id))) return res.status(403).json({ error: 'dm_access_required' });
  const { limit, offset } = pagination(req.query);
  const category = text(req.query.category, 50);
  const archived = req.query.archived === 'true';
  const result = await pool.query(
    `SELECT id, campaign_id, character_id, title, content, category, tags, color,
            is_pinned, archived_at, created_at, updated_at
     FROM dm_notes
     WHERE campaign_id = $1
       AND ($2::text = '' OR category = $2)
       AND (($3::boolean AND archived_at IS NOT NULL) OR (NOT $3::boolean AND archived_at IS NULL))
     ORDER BY is_pinned DESC, updated_at DESC, id DESC
     LIMIT $4 OFFSET $5`,
    [campaignId, category, archived, limit, offset],
  );
  return res.json(result.rows);
}

async function createDmNote(req, res) {
  const campaignId = requireCampaignId(req, res);
  if (!campaignId) return;
  if (!(await requireDm(campaignId, req.user.id))) return res.status(403).json({ error: 'dm_access_required' });
  const title = text(req.body?.title, 200);
  if (!title) return res.status(400).json({ error: 'invalid_note_title' });
  const characterId = parseId(req.body?.characterId);
  if (characterId) {
    const membership = await pool.query('SELECT 1 FROM campaign_members WHERE campaign_id = $1 AND character_id = $2', [
      campaignId,
      characterId,
    ]);
    if (!membership.rows[0]) return res.status(400).json({ error: 'invalid_note_character' });
  }
  const result = await pool.query(
    `INSERT INTO dm_notes
       (campaign_id, created_by, character_id, title, content, category, tags, color, is_pinned)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING *`,
    [
      campaignId,
      req.user.id,
      characterId,
      title,
      optionalText(req.body?.content, 50_000),
      text(req.body?.category, 50) || 'Luźne',
      jsonValue(req.body?.tags, [])
        .map((tag) => text(tag, 40))
        .filter(Boolean)
        .slice(0, 20),
      text(req.body?.color, 20),
      Boolean(req.body?.isPinned),
    ],
  );
  return res.status(201).json(result.rows[0]);
}

async function updateDmNoteRecord(req, res) {
  const campaignId = requireCampaignId(req, res);
  const noteId = parseId(req.params.noteId);
  if (!campaignId || !noteId) return res.status(400).json({ error: 'invalid_note' });
  if (!(await requireDm(campaignId, req.user.id))) return res.status(403).json({ error: 'dm_access_required' });
  const title = text(req.body?.title, 200);
  if (!title) return res.status(400).json({ error: 'invalid_note_title' });
  const result = await pool.query(
    `UPDATE dm_notes
     SET title = $3, content = $4, category = $5, tags = $6, color = $7,
         is_pinned = $8, archived_at = CASE WHEN $9 THEN COALESCE(archived_at, NOW()) ELSE NULL END,
         updated_at = NOW()
     WHERE id = $1 AND campaign_id = $2
     RETURNING *`,
    [
      noteId,
      campaignId,
      title,
      optionalText(req.body?.content, 50_000),
      text(req.body?.category, 50) || 'Luźne',
      jsonValue(req.body?.tags, [])
        .map((tag) => text(tag, 40))
        .filter(Boolean)
        .slice(0, 20),
      text(req.body?.color, 20),
      Boolean(req.body?.isPinned),
      Boolean(req.body?.archived),
    ],
  );
  if (!result.rows[0]) return res.status(404).json({ error: 'note_not_found' });
  return res.json(result.rows[0]);
}

async function archiveDmNote(req, res) {
  const campaignId = requireCampaignId(req, res);
  const noteId = parseId(req.params.noteId);
  if (!campaignId || !noteId) return res.status(400).json({ error: 'invalid_note' });
  if (!(await requireDm(campaignId, req.user.id))) return res.status(403).json({ error: 'dm_access_required' });
  const result = await pool.query(
    `UPDATE dm_notes SET archived_at = NOW(), updated_at = NOW()
     WHERE id = $1 AND campaign_id = $2 RETURNING id`,
    [noteId, campaignId],
  );
  if (!result.rows[0]) return res.status(404).json({ error: 'note_not_found' });
  return res.status(204).end();
}

async function listSessions(req, res) {
  const campaignId = requireCampaignId(req, res);
  if (!campaignId) return;
  if (!(await requireDm(campaignId, req.user.id))) return res.status(403).json({ error: 'dm_access_required' });
  const { limit, offset } = pagination(req.query);
  const status = text(req.query.status, 20);
  const result = await pool.query(
    `SELECT id, number, title, planned_at, actual_at, status, participants, summary,
            created_at, updated_at
     FROM campaign_sessions
     WHERE campaign_id = $1 AND archived_at IS NULL
       AND ($2::text = '' OR status = $2)
     ORDER BY COALESCE(planned_at, created_at) DESC, number DESC
     LIMIT $3 OFFSET $4`,
    [campaignId, status, limit, offset],
  );
  return res.json(result.rows);
}

async function getSession(req, res) {
  const campaignId = requireCampaignId(req, res);
  const sessionId = parseId(req.params.sessionId);
  if (!campaignId || !sessionId) return res.status(400).json({ error: 'invalid_session' });
  if (!(await requireDm(campaignId, req.user.id))) return res.status(403).json({ error: 'dm_access_required' });
  const [session, scenes, events] = await Promise.all([
    pool.query('SELECT * FROM campaign_sessions WHERE id = $1 AND campaign_id = $2 AND archived_at IS NULL', [
      sessionId,
      campaignId,
    ]),
    pool.query('SELECT * FROM session_scenes WHERE session_id = $1 AND campaign_id = $2 ORDER BY sort_order, id', [
      sessionId,
      campaignId,
    ]),
    pool.query(
      'SELECT * FROM session_events WHERE session_id = $1 AND campaign_id = $2 ORDER BY created_at DESC, id DESC LIMIT 200',
      [sessionId, campaignId],
    ),
  ]);
  if (!session.rows[0]) return res.status(404).json({ error: 'session_not_found' });
  return res.json({ ...session.rows[0], scenes: scenes.rows, events: events.rows });
}

function sessionPayload(body) {
  const status = ['planned', 'active', 'completed', 'cancelled'].includes(body?.status) ? body.status : 'planned';
  return {
    number: Math.max(1, Math.min(100_000, Math.trunc(Number(body?.number) || 1))),
    title: text(body?.title, 200),
    plannedAt: body?.plannedAt || null,
    actualAt: body?.actualAt || null,
    status,
    participants: jsonArray(body?.participants).map(parseId).filter(Boolean).slice(0, 100),
    summary: optionalText(body?.summary, 10_000),
    publicSummary: optionalText(body?.publicSummary, 10_000),
    privateSummary: optionalText(body?.privateSummary, 10_000),
    plan: optionalText(body?.plan, 50_000),
    liveNotes: optionalText(body?.liveNotes, 50_000),
    rewards: optionalText(body?.rewards, 10_000),
    checklist: jsonArray(body?.checklist).slice(0, 100),
  };
}

async function createSession(req, res) {
  const campaignId = requireCampaignId(req, res);
  if (!campaignId) return;
  if (!(await requireDm(campaignId, req.user.id))) return res.status(403).json({ error: 'dm_access_required' });
  const value = sessionPayload(req.body);
  if (!value.title) return res.status(400).json({ error: 'invalid_session_title' });
  const result = await pool.query(
    `INSERT INTO campaign_sessions
       (campaign_id, created_by, number, title, planned_at, actual_at, status, participants,
        summary, public_summary, private_summary, plan, live_notes, rewards, checklist)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
     RETURNING *`,
    [
      campaignId,
      req.user.id,
      value.number,
      value.title,
      value.plannedAt,
      value.actualAt,
      value.status,
      value.participants,
      value.summary,
      value.publicSummary,
      value.privateSummary,
      value.plan,
      value.liveNotes,
      value.rewards,
      value.checklist,
    ],
  );
  return res.status(201).json(result.rows[0]);
}

async function updateSession(req, res) {
  const campaignId = requireCampaignId(req, res);
  const sessionId = parseId(req.params.sessionId);
  if (!campaignId || !sessionId) return res.status(400).json({ error: 'invalid_session' });
  if (!(await requireDm(campaignId, req.user.id))) return res.status(403).json({ error: 'dm_access_required' });
  const value = sessionPayload(req.body);
  if (!value.title) return res.status(400).json({ error: 'invalid_session_title' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const previous = await client.query(
      'SELECT status FROM campaign_sessions WHERE id = $1 AND campaign_id = $2 FOR UPDATE',
      [sessionId, campaignId],
    );
    if (!previous.rows[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'session_not_found' });
    }
    const result = await client.query(
      `UPDATE campaign_sessions SET number=$3,title=$4,planned_at=$5,actual_at=$6,status=$7,
        participants=$8,summary=$9,public_summary=$10,private_summary=$11,plan=$12,
        live_notes=$13,rewards=$14,checklist=$15,updated_at=NOW()
       WHERE id=$1 AND campaign_id=$2 RETURNING *`,
      [
        sessionId,
        campaignId,
        value.number,
        value.title,
        value.plannedAt,
        value.actualAt,
        value.status,
        value.participants,
        value.summary,
        value.publicSummary,
        value.privateSummary,
        value.plan,
        value.liveNotes,
        value.rewards,
        value.checklist,
      ],
    );
    if (previous.rows[0].status !== value.status && ['active', 'completed'].includes(value.status)) {
      await client.query(
        `INSERT INTO campaign_timeline_events
           (campaign_id, created_by, event_type, title, content, source_type, source_id, visibility)
         VALUES ($1,$2,$3,$4,$5,'session',$6,'party')`,
        [
          campaignId,
          req.user.id,
          value.status === 'active' ? 'session_started' : 'session_completed',
          `${value.status === 'active' ? 'Rozpoczęto' : 'Zakończono'} sesję: ${value.title}`,
          value.status === 'completed' ? value.publicSummary : '',
          sessionId,
        ],
      );
    }
    await client.query('COMMIT');
    return res.json(result.rows[0]);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function addScene(req, res) {
  const campaignId = requireCampaignId(req, res);
  const sessionId = parseId(req.params.sessionId);
  if (!campaignId || !sessionId) return res.status(400).json({ error: 'invalid_session' });
  if (!(await requireDm(campaignId, req.user.id))) return res.status(403).json({ error: 'dm_access_required' });
  const title = text(req.body?.title, 200);
  if (!title) return res.status(400).json({ error: 'invalid_scene_title' });
  const result = await pool.query(
    `INSERT INTO session_scenes (campaign_id, session_id, title, description, sort_order, relations)
     SELECT $1, id, $3, $4, COALESCE((SELECT MAX(sort_order)+1 FROM session_scenes WHERE session_id=$2),0), $5
     FROM campaign_sessions WHERE id=$2 AND campaign_id=$1
     RETURNING *`,
    [campaignId, sessionId, title, optionalText(req.body?.description, 10_000), jsonValue(req.body?.relations, [])],
  );
  if (!result.rows[0]) return res.status(404).json({ error: 'session_not_found' });
  return res.status(201).json(result.rows[0]);
}

async function updateScene(req, res) {
  const campaignId = requireCampaignId(req, res);
  const sessionId = parseId(req.params.sessionId);
  const sceneId = parseId(req.params.sceneId);
  if (!campaignId || !sessionId || !sceneId) return res.status(400).json({ error: 'invalid_scene' });
  if (!(await requireDm(campaignId, req.user.id))) return res.status(403).json({ error: 'dm_access_required' });
  const status = ['planned', 'completed', 'skipped', 'moved'].includes(req.body?.status) ? req.body.status : 'planned';
  const result = await pool.query(
    `UPDATE session_scenes SET title=$4,description=$5,status=$6,sort_order=$7,relations=$8,updated_at=NOW()
     WHERE id=$1 AND session_id=$2 AND campaign_id=$3 RETURNING *`,
    [
      sceneId,
      sessionId,
      campaignId,
      text(req.body?.title, 200),
      optionalText(req.body?.description, 10_000),
      status,
      Math.max(0, Math.trunc(Number(req.body?.sortOrder) || 0)),
      jsonValue(req.body?.relations, []),
    ],
  );
  if (!result.rows[0]) return res.status(404).json({ error: 'scene_not_found' });
  return res.json(result.rows[0]);
}

async function addSessionEvent(req, res) {
  const campaignId = requireCampaignId(req, res);
  const sessionId = parseId(req.params.sessionId);
  if (!campaignId || !sessionId) return res.status(400).json({ error: 'invalid_session' });
  if (!(await requireDm(campaignId, req.user.id))) return res.status(403).json({ error: 'dm_access_required' });
  const title = text(req.body?.title, 200);
  if (!title) return res.status(400).json({ error: 'invalid_event_title' });
  const visibility = VISIBILITIES.has(req.body?.visibility) ? req.body.visibility : 'dm';
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const session = await client.query('SELECT 1 FROM campaign_sessions WHERE id=$1 AND campaign_id=$2', [
      sessionId,
      campaignId,
    ]);
    if (!session.rows[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'session_not_found' });
    }
    const event = await client.query(
      `INSERT INTO session_events (campaign_id,session_id,created_by,event_type,title,content,visibility,relations)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [
        campaignId,
        sessionId,
        req.user.id,
        text(req.body?.eventType, 40) || 'custom',
        title,
        optionalText(req.body?.content, 10_000),
        visibility,
        jsonValue(req.body?.relations, []),
      ],
    );
    await client.query(
      `INSERT INTO campaign_timeline_events
         (campaign_id,created_by,event_type,title,content,source_type,source_id,visibility,relations)
       VALUES ($1,$2,$3,$4,$5,'session_event',$6,$7,$8)`,
      [
        campaignId,
        req.user.id,
        text(req.body?.eventType, 40) || 'custom',
        title,
        optionalText(req.body?.content, 10_000),
        event.rows[0].id,
        visibility,
        jsonValue(req.body?.relations, []),
      ],
    );
    await client.query('COMMIT');
    return res.status(201).json(event.rows[0]);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

function entityConfig(req, res) {
  const config = ENTITY_CONFIG[req.params.module];
  if (!config) res.status(404).json({ error: 'dm_module_not_found' });
  return config;
}

async function listEntities(req, res) {
  const campaignId = requireCampaignId(req, res);
  const config = entityConfig(req, res);
  if (!campaignId || !config) return;
  if (!(await requireDm(campaignId, req.user.id))) return res.status(403).json({ error: 'dm_access_required' });
  const { limit, offset } = pagination(req.query);
  const status = text(req.query.status, 20);
  const search = text(req.query.search, 100);
  const statusFilter = config.statuses.length ? `AND ($2::text = '' OR status = $2)` : `AND $2::text IS NOT NULL`;
  const result = await pool.query(
    `SELECT * FROM ${config.table}
     WHERE campaign_id = $1 AND archived_at IS NULL ${statusFilter}
       AND ($3::text = '' OR ${config.labelColumn} ILIKE '%' || $3 || '%')
     ORDER BY updated_at DESC, id DESC LIMIT $4 OFFSET $5`,
    [campaignId, status, search, limit, offset],
  );
  return res.json(result.rows);
}

function entityPayload(config, body) {
  const label = text(body?.name ?? body?.title, 200);
  const status = config.statuses.includes(body?.status) ? body.status : config.statuses[0] || '';
  return {
    label,
    publicContent: optionalText(body?.publicContent, 10_000),
    privateContent: optionalText(body?.privateContent, 20_000),
    status,
    visibility: VISIBILITIES.has(body?.visibility) ? body.visibility : 'dm',
    data: jsonValue(body?.data, {}),
    extras: config.extra.map((column) => {
      const camel = column.replace(/_([a-z])/g, (_match, letter) => letter.toUpperCase());
      if (column.endsWith('_id')) return parseId(body?.[camel]);
      if (column === 'attitude') {
        return ['hostile', 'unfriendly', 'neutral', 'friendly', 'allied'].includes(body?.[camel])
          ? body[camel]
          : 'neutral';
      }
      if (column === 'priority') return text(body?.[camel], 20) || 'normal';
      return text(body?.[camel], column.includes('portrait') || column.includes('illustration') ? 500_000 : 2000);
    }),
  };
}

async function createEntity(req, res) {
  const campaignId = requireCampaignId(req, res);
  const config = entityConfig(req, res);
  if (!campaignId || !config) return;
  if (!(await requireDm(campaignId, req.user.id))) return res.status(403).json({ error: 'dm_access_required' });
  const value = entityPayload(config, req.body);
  if (!value.label) return res.status(400).json({ error: 'invalid_entity_name' });
  const columns = ['campaign_id', 'created_by', config.labelColumn, 'public_content', 'private_content'];
  const values = [campaignId, req.user.id, value.label, value.publicContent, value.privateContent];
  if (config.statuses.length) {
    columns.push('status');
    values.push(value.status);
  }
  columns.push('visibility', 'data', ...config.extra);
  values.push(value.visibility, value.data, ...value.extras);
  const placeholders = values.map((_value, index) => `$${index + 1}`).join(',');
  const result = await pool.query(
    `INSERT INTO ${config.table} (${columns.join(',')}) VALUES (${placeholders}) RETURNING *`,
    values,
  );
  return res.status(201).json(result.rows[0]);
}

async function updateEntity(req, res) {
  const campaignId = requireCampaignId(req, res);
  const entityId = parseId(req.params.entityId);
  const config = entityConfig(req, res);
  if (!campaignId || !entityId || !config) return res.status(400).json({ error: 'invalid_entity' });
  if (!(await requireDm(campaignId, req.user.id))) return res.status(403).json({ error: 'dm_access_required' });
  const value = entityPayload(config, req.body);
  if (!value.label) return res.status(400).json({ error: 'invalid_entity_name' });
  const assignments = [`${config.labelColumn}=$3`, 'public_content=$4', 'private_content=$5'];
  const values = [entityId, campaignId, value.label, value.publicContent, value.privateContent];
  if (config.statuses.length) {
    values.push(value.status);
    assignments.push(`status=$${values.length}`);
  }
  values.push(value.visibility);
  assignments.push(`visibility=$${values.length}`);
  values.push(value.data);
  assignments.push(`data=$${values.length}`);
  config.extra.forEach((column, index) => {
    values.push(value.extras[index]);
    assignments.push(`${column}=$${values.length}`);
  });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const previous = await client.query(`SELECT * FROM ${config.table} WHERE id=$1 AND campaign_id=$2 FOR UPDATE`, [
      entityId,
      campaignId,
    ]);
    if (!previous.rows[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'entity_not_found' });
    }
    const result = await client.query(
      `UPDATE ${config.table} SET ${assignments.join(',')},updated_at=NOW()
       WHERE id=$1 AND campaign_id=$2 RETURNING *`,
      values,
    );
    if (config.statuses.length && previous.rows[0].status !== value.status) {
      await client.query(
        `INSERT INTO campaign_timeline_events
           (campaign_id,created_by,event_type,title,content,source_type,source_id,visibility)
         VALUES ($1,$2,'status_changed',$3,$4,$5,$6,$7)`,
        [
          campaignId,
          req.user.id,
          `${value.label}: zmiana statusu`,
          `${previous.rows[0].status} → ${value.status}`,
          req.params.module,
          entityId,
          value.visibility,
        ],
      );
    }
    await client.query('COMMIT');
    return res.json(result.rows[0]);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function archiveEntity(req, res) {
  const campaignId = requireCampaignId(req, res);
  const entityId = parseId(req.params.entityId);
  const config = entityConfig(req, res);
  if (!campaignId || !entityId || !config) return res.status(400).json({ error: 'invalid_entity' });
  if (!(await requireDm(campaignId, req.user.id))) return res.status(403).json({ error: 'dm_access_required' });
  const result = await pool.query(
    `UPDATE ${config.table} SET archived_at=NOW(),updated_at=NOW()
     WHERE id=$1 AND campaign_id=$2 RETURNING id`,
    [entityId, campaignId],
  );
  if (!result.rows[0]) return res.status(404).json({ error: 'entity_not_found' });
  return res.status(204).end();
}

async function listSecrets(req, res) {
  const campaignId = requireCampaignId(req, res);
  if (!campaignId) return;
  if (!(await requireDm(campaignId, req.user.id))) return res.status(403).json({ error: 'dm_access_required' });
  const result = await pool.query(
    `SELECT secret.*, COALESCE(json_agg(json_build_object('characterId', recipients.character_id, 'revealedAt', recipients.revealed_at))
      FILTER (WHERE recipients.character_id IS NOT NULL), '[]') AS recipients
     FROM campaign_secrets secret LEFT JOIN secret_recipients recipients ON recipients.secret_id=secret.id
     WHERE secret.campaign_id=$1 AND secret.archived_at IS NULL
     GROUP BY secret.id ORDER BY secret.updated_at DESC LIMIT 100`,
    [campaignId],
  );
  return res.json(result.rows);
}

async function createSecret(req, res) {
  const campaignId = requireCampaignId(req, res);
  if (!campaignId) return;
  if (!(await requireDm(campaignId, req.user.id))) return res.status(403).json({ error: 'dm_access_required' });
  const title = text(req.body?.title, 200);
  if (!title) return res.status(400).json({ error: 'invalid_secret_title' });
  const discovery = ['undiscovered', 'partial', 'discovered'].includes(req.body?.discoveryStatus)
    ? req.body.discoveryStatus
    : 'undiscovered';
  const result = await pool.query(
    `INSERT INTO campaign_secrets (campaign_id,created_by,title,content,secret_type,discovery_status)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [
      campaignId,
      req.user.id,
      title,
      optionalText(req.body?.content, 20_000),
      text(req.body?.secretType, 40) || 'world_secret',
      discovery,
    ],
  );
  return res.status(201).json(result.rows[0]);
}

async function updateSecret(req, res) {
  const campaignId = requireCampaignId(req, res);
  const secretId = parseId(req.params.secretId);
  if (!campaignId || !secretId) return res.status(400).json({ error: 'invalid_secret' });
  if (!(await requireDm(campaignId, req.user.id))) return res.status(403).json({ error: 'dm_access_required' });
  const title = text(req.body?.title, 200);
  const discovery = ['undiscovered', 'partial', 'discovered'].includes(req.body?.discoveryStatus)
    ? req.body.discoveryStatus
    : 'undiscovered';
  if (!title) return res.status(400).json({ error: 'invalid_secret_title' });
  const result = await pool.query(
    `UPDATE campaign_secrets SET title=$3,content=$4,secret_type=$5,discovery_status=$6,updated_at=NOW()
     WHERE id=$1 AND campaign_id=$2 RETURNING *`,
    [
      secretId,
      campaignId,
      title,
      optionalText(req.body?.content, 20_000),
      text(req.body?.secretType, 40) || 'world_secret',
      discovery,
    ],
  );
  if (!result.rows[0]) return res.status(404).json({ error: 'secret_not_found' });
  return res.json(result.rows[0]);
}

async function archiveSecret(req, res) {
  const campaignId = requireCampaignId(req, res);
  const secretId = parseId(req.params.secretId);
  if (!campaignId || !secretId) return res.status(400).json({ error: 'invalid_secret' });
  if (!(await requireDm(campaignId, req.user.id))) return res.status(403).json({ error: 'dm_access_required' });
  const result = await pool.query(
    'UPDATE campaign_secrets SET archived_at=NOW(),updated_at=NOW() WHERE id=$1 AND campaign_id=$2 RETURNING id',
    [secretId, campaignId],
  );
  if (!result.rows[0]) return res.status(404).json({ error: 'secret_not_found' });
  return res.status(204).end();
}

async function revealSecret(req, res) {
  const campaignId = requireCampaignId(req, res);
  const secretId = parseId(req.params.secretId);
  const recipients = jsonArray(req.body?.characterIds).map(parseId).filter(Boolean).slice(0, 100);
  if (!campaignId || !secretId || !recipients.length || req.body?.confirmed !== true) {
    return res.status(400).json({ error: 'secret_reveal_confirmation_required' });
  }
  if (!(await requireDm(campaignId, req.user.id))) return res.status(403).json({ error: 'dm_access_required' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const secret = await client.query('SELECT title FROM campaign_secrets WHERE id=$1 AND campaign_id=$2 FOR UPDATE', [
      secretId,
      campaignId,
    ]);
    if (!secret.rows[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'secret_not_found' });
    }
    const valid = await client.query(
      `SELECT cm.character_id, cm.user_id FROM campaign_members cm
       WHERE cm.campaign_id=$1 AND cm.character_id=ANY($2::bigint[])`,
      [campaignId, recipients],
    );
    if (valid.rows.length !== new Set(recipients).size) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'invalid_secret_recipients' });
    }
    for (const recipient of valid.rows) {
      const revealed = await client.query(
        `INSERT INTO secret_recipients (secret_id,campaign_id,character_id,revealed_by)
         VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING character_id`,
        [secretId, campaignId, recipient.character_id, req.user.id],
      );
      if (revealed.rows[0]) {
        await client.query(
          `INSERT INTO campaign_content_notifications
             (campaign_id,user_id,notification_type,entity_id,title)
           VALUES ($1,$2,'campaign_secret',$3,$4) ON CONFLICT DO NOTHING`,
          [campaignId, recipient.user_id, secretId, secret.rows[0].title],
        );
      }
    }
    await client.query(`UPDATE campaign_secrets SET discovery_status='discovered',updated_at=NOW() WHERE id=$1`, [
      secretId,
    ]);
    await client.query('COMMIT');
    valid.rows.forEach((recipient) =>
      publishUserNotification(recipient.user_id, { type: 'campaign_secret', campaignId, secretId }),
    );
    return res.status(204).end();
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function listMaterials(req, res) {
  const campaignId = requireCampaignId(req, res);
  if (!campaignId) return;
  if (!(await requireDm(campaignId, req.user.id))) return res.status(403).json({ error: 'dm_access_required' });
  const result = await pool.query(
    `SELECT material.*, COALESCE(json_agg(json_build_object('characterId', recipients.character_id, 'sharedAt', recipients.shared_at))
      FILTER (WHERE recipients.character_id IS NOT NULL), '[]') AS recipients
     FROM campaign_materials material LEFT JOIN material_recipients recipients ON recipients.material_id=material.id
     WHERE material.campaign_id=$1 AND material.archived_at IS NULL
     GROUP BY material.id ORDER BY material.updated_at DESC LIMIT 100`,
    [campaignId],
  );
  return res.json(result.rows);
}

async function createMaterial(req, res) {
  const campaignId = requireCampaignId(req, res);
  if (!campaignId) return;
  if (!(await requireDm(campaignId, req.user.id))) return res.status(403).json({ error: 'dm_access_required' });
  const title = text(req.body?.title, 200);
  const type = ['image', 'letter', 'document', 'item', 'location', 'announcement', 'text', 'link'].includes(
    req.body?.materialType,
  )
    ? req.body.materialType
    : 'text';
  const visibility = VISIBILITIES.has(req.body?.visibility) ? req.body.visibility : 'dm';
  if (!title) return res.status(400).json({ error: 'invalid_material_title' });
  const externalUrl = text(req.body?.externalUrl, 2000);
  if (externalUrl && !/^https?:\/\//i.test(externalUrl)) return res.status(400).json({ error: 'invalid_material_url' });
  const result = await pool.query(
    `INSERT INTO campaign_materials (campaign_id,created_by,title,material_type,content,external_url,visibility)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [campaignId, req.user.id, title, type, optionalText(req.body?.content, 50_000), externalUrl, visibility],
  );
  return res.status(201).json(result.rows[0]);
}

async function updateMaterial(req, res) {
  const campaignId = requireCampaignId(req, res);
  const materialId = parseId(req.params.materialId);
  if (!campaignId || !materialId) return res.status(400).json({ error: 'invalid_material' });
  if (!(await requireDm(campaignId, req.user.id))) return res.status(403).json({ error: 'dm_access_required' });
  const title = text(req.body?.title, 200);
  const type = ['image', 'letter', 'document', 'item', 'location', 'announcement', 'text', 'link'].includes(
    req.body?.materialType,
  )
    ? req.body.materialType
    : 'text';
  const visibility = VISIBILITIES.has(req.body?.visibility) ? req.body.visibility : 'dm';
  const externalUrl = text(req.body?.externalUrl, 2000);
  if (!title || (externalUrl && !/^https?:\/\//i.test(externalUrl))) {
    return res.status(400).json({ error: 'invalid_material' });
  }
  const result = await pool.query(
    `UPDATE campaign_materials SET title=$3,material_type=$4,content=$5,external_url=$6,
       visibility=$7,updated_at=NOW() WHERE id=$1 AND campaign_id=$2 RETURNING *`,
    [materialId, campaignId, title, type, optionalText(req.body?.content, 50_000), externalUrl, visibility],
  );
  if (!result.rows[0]) return res.status(404).json({ error: 'material_not_found' });
  return res.json(result.rows[0]);
}

async function archiveMaterial(req, res) {
  const campaignId = requireCampaignId(req, res);
  const materialId = parseId(req.params.materialId);
  if (!campaignId || !materialId) return res.status(400).json({ error: 'invalid_material' });
  if (!(await requireDm(campaignId, req.user.id))) return res.status(403).json({ error: 'dm_access_required' });
  const result = await pool.query(
    'UPDATE campaign_materials SET archived_at=NOW(),updated_at=NOW() WHERE id=$1 AND campaign_id=$2 RETURNING id',
    [materialId, campaignId],
  );
  if (!result.rows[0]) return res.status(404).json({ error: 'material_not_found' });
  return res.status(204).end();
}

async function listQuestSteps(req, res) {
  const campaignId = requireCampaignId(req, res);
  const questId = parseId(req.params.questId);
  if (!campaignId || !questId) return res.status(400).json({ error: 'invalid_quest' });
  if (!(await requireDm(campaignId, req.user.id))) return res.status(403).json({ error: 'dm_access_required' });
  const result = await pool.query(
    'SELECT * FROM quest_steps WHERE campaign_id=$1 AND quest_id=$2 ORDER BY sort_order,id',
    [campaignId, questId],
  );
  return res.json(result.rows);
}

async function createQuestStep(req, res) {
  const campaignId = requireCampaignId(req, res);
  const questId = parseId(req.params.questId);
  const title = text(req.body?.title, 300);
  if (!campaignId || !questId || !title) return res.status(400).json({ error: 'invalid_quest_step' });
  if (!(await requireDm(campaignId, req.user.id))) return res.status(403).json({ error: 'dm_access_required' });
  const result = await pool.query(
    `INSERT INTO quest_steps (campaign_id,quest_id,title,sort_order)
     SELECT $1,id,$3,COALESCE((SELECT MAX(sort_order)+1 FROM quest_steps WHERE quest_id=$2),0)
     FROM campaign_quests WHERE id=$2 AND campaign_id=$1 RETURNING *`,
    [campaignId, questId, title],
  );
  if (!result.rows[0]) return res.status(404).json({ error: 'quest_not_found' });
  return res.status(201).json(result.rows[0]);
}

async function updateQuestStep(req, res) {
  const campaignId = requireCampaignId(req, res);
  const questId = parseId(req.params.questId);
  const stepId = parseId(req.params.stepId);
  const title = text(req.body?.title, 300);
  if (!campaignId || !questId || !stepId || !title) return res.status(400).json({ error: 'invalid_quest_step' });
  if (!(await requireDm(campaignId, req.user.id))) return res.status(403).json({ error: 'dm_access_required' });
  const result = await pool.query(
    `UPDATE quest_steps SET title=$4,is_completed=$5,sort_order=$6,updated_at=NOW()
     WHERE id=$1 AND quest_id=$2 AND campaign_id=$3 RETURNING *`,
    [
      stepId,
      questId,
      campaignId,
      title,
      Boolean(req.body?.isCompleted),
      Math.max(0, Math.trunc(Number(req.body?.sortOrder) || 0)),
    ],
  );
  if (!result.rows[0]) return res.status(404).json({ error: 'quest_step_not_found' });
  return res.json(result.rows[0]);
}

async function deleteQuestStep(req, res) {
  const campaignId = requireCampaignId(req, res);
  const questId = parseId(req.params.questId);
  const stepId = parseId(req.params.stepId);
  if (!campaignId || !questId || !stepId) return res.status(400).json({ error: 'invalid_quest_step' });
  if (!(await requireDm(campaignId, req.user.id))) return res.status(403).json({ error: 'dm_access_required' });
  const result = await pool.query(
    'DELETE FROM quest_steps WHERE id=$1 AND quest_id=$2 AND campaign_id=$3 RETURNING id',
    [stepId, questId, campaignId],
  );
  if (!result.rows[0]) return res.status(404).json({ error: 'quest_step_not_found' });
  return res.status(204).end();
}

async function shareMaterial(req, res) {
  const campaignId = requireCampaignId(req, res);
  const materialId = parseId(req.params.materialId);
  const recipients = jsonArray(req.body?.characterIds).map(parseId).filter(Boolean).slice(0, 100);
  if (!campaignId || !materialId || !recipients.length || req.body?.confirmed !== true) {
    return res.status(400).json({ error: 'material_share_confirmation_required' });
  }
  if (!(await requireDm(campaignId, req.user.id))) return res.status(403).json({ error: 'dm_access_required' });
  const valid = await pool.query(
    `SELECT cm.character_id,cm.user_id FROM campaign_members cm
     WHERE cm.campaign_id=$1 AND cm.character_id=ANY($2::bigint[])`,
    [campaignId, recipients],
  );
  if (valid.rows.length !== new Set(recipients).size)
    return res.status(400).json({ error: 'invalid_material_recipients' });
  const material = await pool.query('SELECT id,title FROM campaign_materials WHERE id=$1 AND campaign_id=$2', [
    materialId,
    campaignId,
  ]);
  if (!material.rows[0]) return res.status(404).json({ error: 'material_not_found' });
  for (const recipient of valid.rows) {
    const inserted = await pool.query(
      `INSERT INTO material_recipients (material_id,campaign_id,character_id,shared_by,notified_at)
       VALUES ($1,$2,$3,$4,NOW()) ON CONFLICT DO NOTHING RETURNING character_id`,
      [materialId, campaignId, recipient.character_id, req.user.id],
    );
    if (inserted.rows[0])
      await pool.query(
        `INSERT INTO campaign_content_notifications
           (campaign_id,user_id,notification_type,entity_id,title)
         VALUES ($1,$2,'campaign_material',$3,$4)
         ON CONFLICT DO NOTHING`,
        [campaignId, recipient.user_id, materialId, material.rows[0].title],
      );
    if (inserted.rows[0])
      publishUserNotification(recipient.user_id, { type: 'campaign_material', campaignId, materialId });
  }
  return res.status(204).end();
}

async function listSharedCampaignContent(req, res) {
  const campaignId = requireCampaignId(req, res);
  if (!campaignId) return;
  const membership = await pool.query('SELECT character_id FROM campaign_members WHERE campaign_id=$1 AND user_id=$2', [
    campaignId,
    req.user.id,
  ]);
  const characterId = membership.rows[0]?.character_id;
  if (!characterId) return res.status(404).json({ error: 'campaign_not_found' });
  const [materials, secrets, quests] = await Promise.all([
    pool.query(
      `SELECT DISTINCT material.id,material.title,material.material_type,material.content,
              material.external_url,material.updated_at
       FROM campaign_materials material
       LEFT JOIN material_recipients recipient
         ON recipient.material_id=material.id AND recipient.character_id=$2
       WHERE material.campaign_id=$1 AND material.archived_at IS NULL
         AND (material.visibility='party' OR recipient.character_id IS NOT NULL)
       ORDER BY material.updated_at DESC`,
      [campaignId, characterId],
    ),
    pool.query(
      `SELECT secret.id,secret.title,secret.content,secret.secret_type,recipient.revealed_at
       FROM campaign_secrets secret
       JOIN secret_recipients recipient ON recipient.secret_id=secret.id AND recipient.character_id=$2
       WHERE secret.campaign_id=$1 AND secret.archived_at IS NULL
       ORDER BY recipient.revealed_at DESC`,
      [campaignId, characterId],
    ),
    pool.query(
      `SELECT quest.id,quest.name,quest.public_content,quest.status,quest.updated_at,
              quest.data->>'mainGoal' AS main_goal,
              quest.data->>'commissioner' AS commissioner,
              quest.data->>'rewards' AS rewards,
              COALESCE(
                json_agg(
                  json_build_object(
                    'id',step.id,
                    'title',step.title,
                    'is_completed',step.is_completed,
                    'sort_order',step.sort_order
                  ) ORDER BY step.sort_order,step.id
                ) FILTER (WHERE step.id IS NOT NULL),
                '[]'::json
              ) AS steps
       FROM campaign_quests quest
       LEFT JOIN quest_steps step ON step.quest_id=quest.id
       WHERE quest.campaign_id=$1 AND quest.archived_at IS NULL AND quest.visibility='party'
       GROUP BY quest.id
       ORDER BY quest.updated_at DESC,quest.id DESC`,
      [campaignId],
    ),
  ]);
  return res.json({ materials: materials.rows, secrets: secrets.rows, quests: quests.rows });
}

async function listTimeline(req, res) {
  const campaignId = requireCampaignId(req, res);
  if (!campaignId) return;
  if (!(await requireDm(campaignId, req.user.id))) return res.status(403).json({ error: 'dm_access_required' });
  const { limit, offset } = pagination(req.query);
  const result = await pool.query(
    `SELECT * FROM campaign_timeline_events WHERE campaign_id=$1
     ORDER BY occurred_at DESC,id DESC LIMIT $2 OFFSET $3`,
    [campaignId, limit, offset],
  );
  return res.json(result.rows);
}

async function createTimelineEvent(req, res) {
  const campaignId = requireCampaignId(req, res);
  if (!campaignId) return;
  if (!(await requireDm(campaignId, req.user.id))) return res.status(403).json({ error: 'dm_access_required' });
  const title = text(req.body?.title, 200);
  if (!title) return res.status(400).json({ error: 'invalid_timeline_title' });
  const visibility = VISIBILITIES.has(req.body?.visibility) ? req.body.visibility : 'dm';
  const result = await pool.query(
    `INSERT INTO campaign_timeline_events
       (campaign_id,created_by,occurred_at,world_date,event_type,title,content,visibility,relations)
     VALUES ($1,$2,COALESCE($3,NOW()),$4,$5,$6,$7,$8,$9) RETURNING *`,
    [
      campaignId,
      req.user.id,
      req.body?.occurredAt || null,
      text(req.body?.worldDate, 100),
      text(req.body?.eventType, 40) || 'manual',
      title,
      optionalText(req.body?.content, 10_000),
      visibility,
      jsonValue(req.body?.relations, []),
    ],
  );
  return res.status(201).json(result.rows[0]);
}

async function listRelations(req, res) {
  const campaignId = requireCampaignId(req, res);
  const sourceId = parseId(req.query.sourceId);
  const sourceType = text(req.query.sourceType, 40);
  if (!campaignId || !sourceId || !sourceType) return res.status(400).json({ error: 'invalid_relation_source' });
  if (!(await requireDm(campaignId, req.user.id))) return res.status(403).json({ error: 'dm_access_required' });
  const result = await pool.query(
    `SELECT * FROM entity_relations WHERE campaign_id=$1 AND source_type=$2 AND source_id=$3
     ORDER BY created_at,id`,
    [campaignId, sourceType, sourceId],
  );
  return res.json(result.rows);
}

async function createRelation(req, res) {
  const campaignId = requireCampaignId(req, res);
  const sourceId = parseId(req.body?.sourceId);
  const targetId = parseId(req.body?.targetId);
  const sourceType = text(req.body?.sourceType, 40);
  const targetType = text(req.body?.targetType, 40);
  if (!campaignId || !sourceId || !targetId || !sourceType || !targetType) {
    return res.status(400).json({ error: 'invalid_relation' });
  }
  if (!(await requireDm(campaignId, req.user.id))) return res.status(403).json({ error: 'dm_access_required' });
  const result = await pool.query(
    `INSERT INTO entity_relations
       (campaign_id,source_type,source_id,target_type,target_id,relation_type,created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (campaign_id,source_type,source_id,target_type,target_id,relation_type)
     DO UPDATE SET relation_type=EXCLUDED.relation_type RETURNING *`,
    [
      campaignId,
      sourceType,
      sourceId,
      targetType,
      targetId,
      text(req.body?.relationType, 40) || 'related',
      req.user.id,
    ],
  );
  return res.status(201).json(result.rows[0]);
}

async function deleteRelation(req, res) {
  const campaignId = requireCampaignId(req, res);
  const relationId = parseId(req.params.relationId);
  if (!campaignId || !relationId) return res.status(400).json({ error: 'invalid_relation' });
  if (!(await requireDm(campaignId, req.user.id))) return res.status(403).json({ error: 'dm_access_required' });
  const result = await pool.query('DELETE FROM entity_relations WHERE id=$1 AND campaign_id=$2 RETURNING id', [
    relationId,
    campaignId,
  ]);
  if (!result.rows[0]) return res.status(404).json({ error: 'relation_not_found' });
  return res.status(204).end();
}

async function getCampaignSettings(req, res) {
  const campaignId = requireCampaignId(req, res);
  if (!campaignId) return;
  const campaign = await requireDm(campaignId, req.user.id);
  if (!campaign) return res.status(403).json({ error: 'dm_access_required' });
  const members = await pool.query(
    `SELECT cm.user_id,cm.character_id,cm.role,u.username,ch.name AS character_name
     FROM campaign_members cm JOIN users u ON u.id=cm.user_id
     LEFT JOIN characters ch ON ch.id=cm.character_id
     WHERE cm.campaign_id=$1 ORDER BY cm.joined_at,cm.user_id`,
    [campaignId],
  );
  return res.json({
    campaign: { ...campaign, id: Number(campaign.id), owner_id: Number(campaign.owner_id) },
    members: members.rows,
  });
}

async function updateCampaignSettings(req, res) {
  const campaignId = requireCampaignId(req, res);
  if (!campaignId) return;
  const campaign = await requireDm(campaignId, req.user.id);
  if (!campaign) return res.status(403).json({ error: 'dm_access_required' });
  const name = text(req.body?.name, 100);
  if (!name) return res.status(400).json({ error: 'invalid_campaign_name' });
  const result = await pool.query(
    `UPDATE campaigns SET name=$3,description=$4,image=$5
     WHERE id=$1 AND owner_id=$2 RETURNING id,name,description,image,created_at,archived_at`,
    [campaignId, req.user.id, name, optionalText(req.body?.description, 2000), text(req.body?.image, 500_000)],
  );
  if (!result.rows[0]) return res.status(403).json({ error: 'campaign_owner_required' });
  return res.json(result.rows[0]);
}

async function updateCampaignRole(req, res) {
  const campaignId = requireCampaignId(req, res);
  const memberUserId = parseId(req.params.userId);
  if (!campaignId || !memberUserId) return res.status(400).json({ error: 'invalid_campaign_member' });
  const campaign = await pool.query('SELECT owner_id FROM campaigns WHERE id=$1 AND owner_id=$2', [
    campaignId,
    req.user.id,
  ]);
  if (!campaign.rows[0]) return res.status(403).json({ error: 'campaign_owner_required' });
  if (Number(campaign.rows[0].owner_id) === memberUserId) return res.status(400).json({ error: 'owner_role_locked' });
  const role = req.body?.role === 'co_dm' ? 'co_dm' : 'player';
  const result = await pool.query(
    `UPDATE campaign_members SET role=$3 WHERE campaign_id=$1 AND user_id=$2 RETURNING user_id,role`,
    [campaignId, memberUserId, role],
  );
  if (!result.rows[0]) return res.status(404).json({ error: 'campaign_member_not_found' });
  return res.json(result.rows[0]);
}

async function removeCampaignMember(req, res) {
  const campaignId = requireCampaignId(req, res);
  const memberUserId = parseId(req.params.userId);
  if (!campaignId || !memberUserId) return res.status(400).json({ error: 'invalid_campaign_member' });
  const campaign = await pool.query('SELECT owner_id FROM campaigns WHERE id=$1 AND owner_id=$2', [
    campaignId,
    req.user.id,
  ]);
  if (!campaign.rows[0]) return res.status(403).json({ error: 'campaign_owner_required' });
  if (Number(campaign.rows[0].owner_id) === memberUserId)
    return res.status(400).json({ error: 'campaign_owner_cannot_be_removed' });
  const result = await pool.query(
    'DELETE FROM campaign_members WHERE campaign_id=$1 AND user_id=$2 RETURNING user_id',
    [campaignId, memberUserId],
  );
  if (!result.rows[0]) return res.status(404).json({ error: 'campaign_member_not_found' });
  return res.status(204).end();
}

async function archiveCampaign(req, res) {
  const campaignId = requireCampaignId(req, res);
  if (!campaignId || req.body?.confirmed !== true)
    return res.status(400).json({ error: 'campaign_archive_confirmation_required' });
  const result = await pool.query(
    'UPDATE campaigns SET archived_at=COALESCE(archived_at,NOW()) WHERE id=$1 AND owner_id=$2 RETURNING id,archived_at',
    [campaignId, req.user.id],
  );
  if (!result.rows[0]) return res.status(403).json({ error: 'campaign_owner_required' });
  return res.json(result.rows[0]);
}

async function exportCampaign(req, res) {
  const campaignId = requireCampaignId(req, res);
  if (!campaignId) return;
  const campaign = await requireDm(campaignId, req.user.id);
  if (!campaign) return res.status(403).json({ error: 'dm_access_required' });
  const tables = [
    'campaign_members',
    'dm_notes',
    'campaign_sessions',
    'session_scenes',
    'session_events',
    'campaign_npcs',
    'campaign_locations',
    'campaign_factions',
    'campaign_quests',
    'quest_steps',
    'campaign_story_threads',
    'campaign_secrets',
    'secret_recipients',
    'campaign_materials',
    'material_recipients',
    'campaign_timeline_events',
    'entity_relations',
  ];
  const data = {};
  for (const table of tables) {
    data[table] = (await pool.query(`SELECT * FROM ${table} WHERE campaign_id=$1 ORDER BY 1`, [campaignId])).rows;
  }
  res.set('Content-Disposition', `attachment; filename="campaign-${campaignId}.json"`);
  return res.json({ exportedAt: new Date().toISOString(), campaign, data });
}

module.exports = {
  addScene,
  addSessionEvent,
  archiveDmNote,
  archiveCampaign,
  archiveEntity,
  archiveMaterial,
  archiveSecret,
  createQuestStep,
  createDmNote,
  createEntity,
  createMaterial,
  createRelation,
  createSecret,
  createSession,
  createTimelineEvent,
  exportCampaign,
  getCampaignSettings,
  getSession,
  listDmNotes,
  listEntities,
  listMaterials,
  listQuestSteps,
  listRelations,
  listSecrets,
  listSharedCampaignContent,
  listSessions,
  listTimeline,
  requireDm,
  revealSecret,
  removeCampaignMember,
  deleteRelation,
  shareMaterial,
  updateCampaignRole,
  updateCampaignSettings,
  updateDmNoteRecord,
  updateEntity,
  updateMaterial,
  updateQuestStep,
  updateScene,
  updateSecret,
  updateSession,
  deleteQuestStep,
};
