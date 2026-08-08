CREATE TABLE IF NOT EXISTS direct_messages (
  id BIGSERIAL PRIMARY KEY,
  sender_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipient_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT direct_messages_not_self CHECK (sender_id <> recipient_id),
  CONSTRAINT direct_messages_body_length CHECK (char_length(body) BETWEEN 1 AND 2000)
);

CREATE INDEX IF NOT EXISTS direct_messages_conversation_idx
  ON direct_messages(sender_id, recipient_id, created_at DESC);

CREATE INDEX IF NOT EXISTS direct_messages_recipient_unread_idx
  ON direct_messages(recipient_id, read_at)
  WHERE read_at IS NULL;
