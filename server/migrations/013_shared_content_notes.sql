CREATE TABLE IF NOT EXISTS campaign_shared_content_notes (
  campaign_id BIGINT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  content_type VARCHAR(20) NOT NULL CHECK (content_type IN ('material', 'secret')),
  content_id BIGINT NOT NULL,
  content VARCHAR(20000) NOT NULL DEFAULT '',
  updated_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (campaign_id, content_type, content_id)
);

CREATE INDEX IF NOT EXISTS campaign_shared_content_notes_updated_idx
  ON campaign_shared_content_notes(campaign_id, updated_at DESC);
