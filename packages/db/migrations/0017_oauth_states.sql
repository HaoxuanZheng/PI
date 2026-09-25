-- OAuth authorization states: single-use CSRF tokens binding a consent dance
-- to the user who started it. The callback consumes the row; replays and
-- foreign-user states fail closed. Short expiry bounds the window.
CREATE TABLE oauth_states (
 state text PRIMARY KEY,
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 provider text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL,
 CONSTRAINT oauth_states_provider CHECK (provider IN ('GOOGLE_DRIVE','GOOGLE_CONTACTS','NOTION'))
);
CREATE INDEX oauth_states_expires_idx ON oauth_states(expires_at);
ALTER TABLE oauth_states ENABLE ROW LEVEL SECURITY; ALTER TABLE oauth_states FORCE ROW LEVEL SECURITY;
CREATE POLICY oauth_states_owner_select_policy ON oauth_states FOR SELECT USING (user_id=nullif(current_setting('app.current_user_id',true),'')::uuid);
CREATE POLICY oauth_states_insert_policy ON oauth_states FOR INSERT WITH CHECK (user_id=nullif(current_setting('app.current_user_id',true),'')::uuid);
CREATE POLICY oauth_states_update_policy ON oauth_states FOR UPDATE USING (user_id=nullif(current_setting('app.current_user_id',true),'')::uuid) WITH CHECK (user_id=nullif(current_setting('app.current_user_id',true),'')::uuid);
CREATE POLICY oauth_states_delete_policy ON oauth_states FOR DELETE USING (user_id=nullif(current_setting('app.current_user_id',true),'')::uuid);
