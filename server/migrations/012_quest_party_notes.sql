CREATE TABLE IF NOT EXISTS quest_party_notes (
  quest_id BIGINT PRIMARY KEY REFERENCES campaign_quests(id) ON DELETE CASCADE,
  campaign_id BIGINT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  content VARCHAR(20000) NOT NULL DEFAULT '',
  updated_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS quest_party_notes_campaign_idx
  ON quest_party_notes(campaign_id, updated_at DESC);
