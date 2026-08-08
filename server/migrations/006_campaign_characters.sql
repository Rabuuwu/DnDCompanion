ALTER TABLE campaign_members
  ADD COLUMN IF NOT EXISTS character_id BIGINT REFERENCES characters(id) ON DELETE CASCADE;

CREATE UNIQUE INDEX IF NOT EXISTS campaign_members_character_unique
  ON campaign_members(campaign_id, character_id)
  WHERE character_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS campaign_members_character_idx
  ON campaign_members(character_id)
  WHERE character_id IS NOT NULL;
