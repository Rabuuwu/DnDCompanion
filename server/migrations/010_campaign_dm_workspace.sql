ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS description VARCHAR(2000) NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS image TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS dm_notes (
  id BIGSERIAL PRIMARY KEY,
  campaign_id BIGINT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  created_by BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  character_id BIGINT REFERENCES characters(id) ON DELETE CASCADE,
  title VARCHAR(200) NOT NULL,
  content VARCHAR(50000) NOT NULL DEFAULT '',
  category VARCHAR(50) NOT NULL DEFAULT 'Luźne',
  tags TEXT[] NOT NULL DEFAULT '{}',
  color VARCHAR(20) NOT NULL DEFAULT '',
  is_pinned BOOLEAN NOT NULL DEFAULT FALSE,
  archived_at TIMESTAMPTZ,
  legacy_general BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT dm_notes_title_length CHECK (char_length(title) BETWEEN 1 AND 200),
  CONSTRAINT dm_notes_category_length CHECK (char_length(category) BETWEEN 1 AND 50)
);
CREATE INDEX IF NOT EXISTS dm_notes_campaign_updated_idx ON dm_notes(campaign_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS dm_notes_campaign_category_idx ON dm_notes(campaign_id, category) WHERE archived_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS dm_notes_legacy_general_unique
  ON dm_notes(campaign_id, created_by) WHERE legacy_general = TRUE;

INSERT INTO dm_notes (campaign_id, created_by, title, content, category, legacy_general, created_at, updated_at)
SELECT campaign_id, dm_user_id, 'Ogólna notatka DM', content, 'Luźne', TRUE, updated_at, updated_at
FROM campaign_dm_notes
WHERE BTRIM(content) <> ''
ON CONFLICT (campaign_id, created_by) WHERE legacy_general = TRUE DO NOTHING;

CREATE TABLE IF NOT EXISTS campaign_sessions (
  id BIGSERIAL PRIMARY KEY,
  campaign_id BIGINT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  created_by BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  number INTEGER NOT NULL DEFAULT 1,
  title VARCHAR(200) NOT NULL,
  planned_at TIMESTAMPTZ,
  actual_at TIMESTAMPTZ,
  status VARCHAR(20) NOT NULL DEFAULT 'planned',
  participants BIGINT[] NOT NULL DEFAULT '{}',
  summary VARCHAR(10000) NOT NULL DEFAULT '',
  public_summary VARCHAR(10000) NOT NULL DEFAULT '',
  private_summary VARCHAR(10000) NOT NULL DEFAULT '',
  plan VARCHAR(50000) NOT NULL DEFAULT '',
  live_notes VARCHAR(50000) NOT NULL DEFAULT '',
  rewards VARCHAR(10000) NOT NULL DEFAULT '',
  checklist JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  archived_at TIMESTAMPTZ,
  CONSTRAINT campaign_sessions_status CHECK (status IN ('planned', 'active', 'completed', 'cancelled')),
  CONSTRAINT campaign_sessions_number CHECK (number > 0)
);
CREATE INDEX IF NOT EXISTS campaign_sessions_campaign_status_idx ON campaign_sessions(campaign_id, status, planned_at);
CREATE INDEX IF NOT EXISTS campaign_sessions_campaign_updated_idx ON campaign_sessions(campaign_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS session_scenes (
  id BIGSERIAL PRIMARY KEY,
  campaign_id BIGINT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  session_id BIGINT NOT NULL REFERENCES campaign_sessions(id) ON DELETE CASCADE,
  title VARCHAR(200) NOT NULL,
  description VARCHAR(10000) NOT NULL DEFAULT '',
  status VARCHAR(20) NOT NULL DEFAULT 'planned',
  sort_order INTEGER NOT NULL DEFAULT 0,
  relations JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT session_scenes_status CHECK (status IN ('planned', 'completed', 'skipped', 'moved'))
);
CREATE INDEX IF NOT EXISTS session_scenes_session_order_idx ON session_scenes(session_id, sort_order, id);

CREATE TABLE IF NOT EXISTS session_events (
  id BIGSERIAL PRIMARY KEY,
  campaign_id BIGINT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  session_id BIGINT NOT NULL REFERENCES campaign_sessions(id) ON DELETE CASCADE,
  created_by BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_type VARCHAR(40) NOT NULL,
  title VARCHAR(200) NOT NULL,
  content VARCHAR(10000) NOT NULL DEFAULT '',
  visibility VARCHAR(20) NOT NULL DEFAULT 'dm',
  relations JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT session_events_visibility CHECK (visibility IN ('dm', 'party', 'selected'))
);
CREATE INDEX IF NOT EXISTS session_events_session_created_idx ON session_events(session_id, created_at DESC);

CREATE TABLE IF NOT EXISTS campaign_npcs (
  id BIGSERIAL PRIMARY KEY,
  campaign_id BIGINT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  created_by BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name VARCHAR(200) NOT NULL,
  portrait TEXT NOT NULL DEFAULT '',
  public_content VARCHAR(10000) NOT NULL DEFAULT '',
  private_content VARCHAR(20000) NOT NULL DEFAULT '',
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  visibility VARCHAR(20) NOT NULL DEFAULT 'dm',
  data JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  archived_at TIMESTAMPTZ,
  CONSTRAINT campaign_npcs_status CHECK (status IN ('active', 'missing', 'dead', 'unknown')),
  CONSTRAINT campaign_npcs_visibility CHECK (visibility IN ('dm', 'party', 'selected'))
);

CREATE TABLE IF NOT EXISTS campaign_locations (
  id BIGSERIAL PRIMARY KEY,
  campaign_id BIGINT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  created_by BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  parent_id BIGINT REFERENCES campaign_locations(id) ON DELETE SET NULL,
  name VARCHAR(200) NOT NULL,
  location_type VARCHAR(80) NOT NULL DEFAULT '',
  illustration TEXT NOT NULL DEFAULT '',
  public_content VARCHAR(10000) NOT NULL DEFAULT '',
  private_content VARCHAR(20000) NOT NULL DEFAULT '',
  visibility VARCHAR(20) NOT NULL DEFAULT 'dm',
  data JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  archived_at TIMESTAMPTZ,
  CONSTRAINT campaign_locations_visibility CHECK (visibility IN ('dm', 'party', 'selected'))
);

CREATE TABLE IF NOT EXISTS campaign_factions (
  id BIGSERIAL PRIMARY KEY,
  campaign_id BIGINT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  created_by BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name VARCHAR(200) NOT NULL,
  symbol TEXT NOT NULL DEFAULT '',
  public_content VARCHAR(10000) NOT NULL DEFAULT '',
  private_content VARCHAR(20000) NOT NULL DEFAULT '',
  attitude VARCHAR(20) NOT NULL DEFAULT 'neutral',
  visibility VARCHAR(20) NOT NULL DEFAULT 'dm',
  data JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  archived_at TIMESTAMPTZ,
  CONSTRAINT campaign_factions_attitude CHECK (attitude IN ('hostile', 'unfriendly', 'neutral', 'friendly', 'allied')),
  CONSTRAINT campaign_factions_visibility CHECK (visibility IN ('dm', 'party', 'selected'))
);

CREATE TABLE IF NOT EXISTS campaign_quests (
  id BIGSERIAL PRIMARY KEY,
  campaign_id BIGINT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  created_by BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name VARCHAR(200) NOT NULL,
  public_content VARCHAR(10000) NOT NULL DEFAULT '',
  private_content VARCHAR(20000) NOT NULL DEFAULT '',
  status VARCHAR(20) NOT NULL DEFAULT 'prepared',
  visibility VARCHAR(20) NOT NULL DEFAULT 'dm',
  data JSONB NOT NULL DEFAULT '{}',
  started_session_id BIGINT REFERENCES campaign_sessions(id) ON DELETE SET NULL,
  completed_session_id BIGINT REFERENCES campaign_sessions(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  archived_at TIMESTAMPTZ,
  CONSTRAINT campaign_quests_status CHECK (status IN ('prepared', 'available', 'active', 'paused', 'completed', 'failed', 'hidden')),
  CONSTRAINT campaign_quests_visibility CHECK (visibility IN ('dm', 'party', 'selected'))
);

CREATE TABLE IF NOT EXISTS quest_steps (
  id BIGSERIAL PRIMARY KEY,
  campaign_id BIGINT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  quest_id BIGINT NOT NULL REFERENCES campaign_quests(id) ON DELETE CASCADE,
  title VARCHAR(300) NOT NULL,
  is_completed BOOLEAN NOT NULL DEFAULT FALSE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS campaign_story_threads (
  id BIGSERIAL PRIMARY KEY,
  campaign_id BIGINT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  created_by BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title VARCHAR(200) NOT NULL,
  public_content VARCHAR(10000) NOT NULL DEFAULT '',
  private_content VARCHAR(20000) NOT NULL DEFAULT '',
  status VARCHAR(20) NOT NULL DEFAULT 'idea',
  priority VARCHAR(20) NOT NULL DEFAULT 'normal',
  visibility VARCHAR(20) NOT NULL DEFAULT 'dm',
  data JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  archived_at TIMESTAMPTZ,
  CONSTRAINT campaign_story_threads_status CHECK (status IN ('idea', 'prepared', 'active', 'paused', 'resolved', 'abandoned')),
  CONSTRAINT campaign_story_threads_visibility CHECK (visibility IN ('dm', 'party', 'selected'))
);

CREATE TABLE IF NOT EXISTS campaign_secrets (
  id BIGSERIAL PRIMARY KEY,
  campaign_id BIGINT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  created_by BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title VARCHAR(200) NOT NULL,
  content VARCHAR(20000) NOT NULL DEFAULT '',
  secret_type VARCHAR(40) NOT NULL DEFAULT 'world_secret',
  discovery_status VARCHAR(20) NOT NULL DEFAULT 'undiscovered',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  archived_at TIMESTAMPTZ,
  CONSTRAINT campaign_secrets_discovery CHECK (discovery_status IN ('undiscovered', 'partial', 'discovered'))
);

CREATE TABLE IF NOT EXISTS secret_recipients (
  secret_id BIGINT NOT NULL REFERENCES campaign_secrets(id) ON DELETE CASCADE,
  campaign_id BIGINT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  character_id BIGINT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  revealed_by BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  revealed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (secret_id, character_id)
);

CREATE TABLE IF NOT EXISTS campaign_materials (
  id BIGSERIAL PRIMARY KEY,
  campaign_id BIGINT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  created_by BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title VARCHAR(200) NOT NULL,
  material_type VARCHAR(30) NOT NULL DEFAULT 'text',
  content VARCHAR(50000) NOT NULL DEFAULT '',
  external_url VARCHAR(2000) NOT NULL DEFAULT '',
  visibility VARCHAR(20) NOT NULL DEFAULT 'dm',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  archived_at TIMESTAMPTZ,
  CONSTRAINT campaign_materials_type CHECK (material_type IN ('image', 'letter', 'document', 'item', 'location', 'announcement', 'text', 'link')),
  CONSTRAINT campaign_materials_visibility CHECK (visibility IN ('dm', 'party', 'selected'))
);

CREATE TABLE IF NOT EXISTS material_recipients (
  material_id BIGINT NOT NULL REFERENCES campaign_materials(id) ON DELETE CASCADE,
  campaign_id BIGINT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  character_id BIGINT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  shared_by BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  shared_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  notified_at TIMESTAMPTZ,
  PRIMARY KEY (material_id, character_id)
);

CREATE TABLE IF NOT EXISTS campaign_timeline_events (
  id BIGSERIAL PRIMARY KEY,
  campaign_id BIGINT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  created_by BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  world_date VARCHAR(100) NOT NULL DEFAULT '',
  event_type VARCHAR(40) NOT NULL,
  title VARCHAR(200) NOT NULL,
  content VARCHAR(10000) NOT NULL DEFAULT '',
  source_type VARCHAR(40) NOT NULL DEFAULT 'manual',
  source_id BIGINT,
  visibility VARCHAR(20) NOT NULL DEFAULT 'dm',
  relations JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT campaign_timeline_visibility CHECK (visibility IN ('dm', 'party', 'selected'))
);

CREATE TABLE IF NOT EXISTS entity_relations (
  id BIGSERIAL PRIMARY KEY,
  campaign_id BIGINT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  source_type VARCHAR(40) NOT NULL,
  source_id BIGINT NOT NULL,
  target_type VARCHAR(40) NOT NULL,
  target_id BIGINT NOT NULL,
  relation_type VARCHAR(40) NOT NULL DEFAULT 'related',
  created_by BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (campaign_id, source_type, source_id, target_type, target_id, relation_type)
);

CREATE INDEX IF NOT EXISTS campaign_npcs_campaign_status_idx ON campaign_npcs(campaign_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS campaign_locations_campaign_updated_idx ON campaign_locations(campaign_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS campaign_factions_campaign_updated_idx ON campaign_factions(campaign_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS campaign_quests_campaign_status_idx ON campaign_quests(campaign_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS quest_steps_quest_order_idx ON quest_steps(quest_id, sort_order, id);
CREATE INDEX IF NOT EXISTS campaign_threads_campaign_status_idx ON campaign_story_threads(campaign_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS campaign_secrets_campaign_status_idx ON campaign_secrets(campaign_id, discovery_status, updated_at DESC);
CREATE INDEX IF NOT EXISTS secret_recipients_campaign_character_idx ON secret_recipients(campaign_id, character_id);
CREATE INDEX IF NOT EXISTS campaign_materials_campaign_updated_idx ON campaign_materials(campaign_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS material_recipients_campaign_character_idx ON material_recipients(campaign_id, character_id);
CREATE INDEX IF NOT EXISTS campaign_timeline_campaign_date_idx ON campaign_timeline_events(campaign_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS entity_relations_source_idx ON entity_relations(campaign_id, source_type, source_id);
CREATE INDEX IF NOT EXISTS entity_relations_target_idx ON entity_relations(campaign_id, target_type, target_id);
