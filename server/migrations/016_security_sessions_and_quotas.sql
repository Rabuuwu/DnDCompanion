CREATE TABLE auth_sessions (
  id UUID PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX auth_sessions_user_id_idx ON auth_sessions(user_id);
CREATE INDEX auth_sessions_expires_at_idx ON auth_sessions(expires_at);
ALTER TABLE refresh_tokens ADD COLUMN session_id UUID REFERENCES auth_sessions(id) ON DELETE CASCADE;
CREATE INDEX refresh_tokens_session_id_idx ON refresh_tokens(session_id);

-- Legacy JWTs have no session identity. Require a fresh login at deployment.
UPDATE refresh_tokens SET revoked_at = COALESCE(revoked_at, NOW()) WHERE session_id IS NULL;

-- Serialize quota checks per account, including concurrent requests/instances.
-- Run with caller privileges; table/column names come only from trigger DDL.
CREATE FUNCTION enforce_account_resource_quota() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  account_id BIGINT;
  used_count BIGINT;
BEGIN
  account_id := (to_jsonb(NEW)->>TG_ARGV[0])::BIGINT;
  PERFORM id FROM users WHERE id = account_id FOR NO KEY UPDATE;
  EXECUTE format('SELECT count(*) FROM %I.%I WHERE %I = $1', TG_TABLE_SCHEMA, TG_TABLE_NAME, TG_ARGV[0])
    INTO used_count USING account_id;
  IF used_count >= TG_ARGV[1]::BIGINT THEN
    RAISE EXCEPTION 'Account resource quota exceeded'
      USING ERRCODE = '23514', CONSTRAINT = 'account_resource_quota';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER characters_quota BEFORE INSERT ON characters FOR EACH ROW
  EXECUTE FUNCTION enforce_account_resource_quota('owner_id', '100');
CREATE TRIGGER campaigns_quota BEFORE INSERT ON campaigns FOR EACH ROW
  EXECUTE FUNCTION enforce_account_resource_quota('owner_id', '50');
CREATE TRIGGER messages_quota BEFORE INSERT ON direct_messages FOR EACH ROW
  EXECUTE FUNCTION enforce_account_resource_quota('sender_id', '50000');
CREATE TRIGGER sessions_quota BEFORE INSERT ON auth_sessions FOR EACH ROW
  EXECUTE FUNCTION enforce_account_resource_quota('user_id', '100');

-- Bounded DM content even when a user owns many campaigns. Existing rows are
-- retained; the quota only prevents new inserts until usage falls below it.
DO $$
DECLARE resource_table TEXT;
BEGIN
  FOREACH resource_table IN ARRAY ARRAY[
    'dm_notes', 'campaign_npcs', 'campaign_locations', 'campaign_factions',
    'campaign_quests', 'campaign_story_threads', 'campaign_secrets', 'campaign_materials'
  ] LOOP
    EXECUTE format('CREATE INDEX %I ON %I(created_by)', resource_table || '_creator_quota_idx', resource_table);
    EXECUTE format('CREATE TRIGGER creator_quota BEFORE INSERT ON %I FOR EACH ROW EXECUTE FUNCTION enforce_account_resource_quota(%L, %L)',
      resource_table, 'created_by', '2000');
  END LOOP;
END $$;
