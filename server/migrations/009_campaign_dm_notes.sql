CREATE TABLE IF NOT EXISTS campaign_dm_notes (
  campaign_id BIGINT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  dm_user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (campaign_id, dm_user_id),
  CONSTRAINT campaign_dm_notes_length CHECK (char_length(content) <= 50000)
);

CREATE TABLE IF NOT EXISTS campaign_character_dm_notes (
  campaign_id BIGINT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  dm_user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  character_id BIGINT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  content TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (campaign_id, dm_user_id, character_id),
  CONSTRAINT campaign_character_dm_notes_length CHECK (char_length(content) <= 50000)
);

CREATE INDEX IF NOT EXISTS campaign_character_dm_notes_character_idx
  ON campaign_character_dm_notes (character_id);
