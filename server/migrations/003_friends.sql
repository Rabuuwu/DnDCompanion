CREATE TABLE IF NOT EXISTS friendships (
  user_low_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_high_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_low_id, user_high_id),
  CONSTRAINT friendships_ordered_users CHECK (user_low_id < user_high_id)
);

CREATE INDEX IF NOT EXISTS friendships_high_user_idx
  ON friendships(user_high_id);

CREATE TABLE IF NOT EXISTS friend_invites (
  id BIGSERIAL PRIMARY KEY,
  owner_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash CHAR(64) NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  used_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS friend_invites_owner_idx
  ON friend_invites(owner_id);

CREATE INDEX IF NOT EXISTS friend_invites_expires_idx
  ON friend_invites(expires_at);
