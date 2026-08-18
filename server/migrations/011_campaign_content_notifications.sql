CREATE TABLE IF NOT EXISTS campaign_content_notifications (
  id BIGSERIAL PRIMARY KEY,
  campaign_id BIGINT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  notification_type VARCHAR(30) NOT NULL,
  entity_id BIGINT NOT NULL,
  title VARCHAR(200) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  read_at TIMESTAMPTZ,
  UNIQUE (user_id, notification_type, entity_id),
  CONSTRAINT campaign_content_notifications_type CHECK (notification_type IN ('campaign_secret', 'campaign_material'))
);

CREATE INDEX IF NOT EXISTS campaign_content_notifications_user_unread_idx
  ON campaign_content_notifications(user_id, created_at DESC)
  WHERE read_at IS NULL;
