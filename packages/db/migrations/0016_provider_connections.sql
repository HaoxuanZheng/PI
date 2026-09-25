-- Per-user provider connections: encrypted tokens owned by exactly one user.
-- Importers prefer a live user connection and fall back to operator tokens.
-- Token material is sealed with AES-256-GCM before insert and is never
-- returned by any read path; status endpoints expose connected/expired only.
CREATE TABLE provider_connections (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 provider text NOT NULL,
 sealed_access_token jsonb NOT NULL,
 sealed_refresh_token jsonb,
 scopes text NOT NULL DEFAULT '{}',
 expires_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT provider_connections_provider CHECK (provider IN ('GOOGLE_DRIVE','GOOGLE_CONTACTS','NOTION'))
);
CREATE UNIQUE INDEX provider_connections_user_provider_uidx ON provider_connections(user_id,provider);
ALTER TABLE provider_connections ENABLE ROW LEVEL SECURITY; ALTER TABLE provider_connections FORCE ROW LEVEL SECURITY;
CREATE POLICY provider_connections_owner_select_policy ON provider_connections FOR SELECT USING (user_id=nullif(current_setting('app.current_user_id',true),'')::uuid);
CREATE POLICY provider_connections_insert_policy ON provider_connections FOR INSERT WITH CHECK (user_id=nullif(current_setting('app.current_user_id',true),'')::uuid);
CREATE POLICY provider_connections_update_policy ON provider_connections FOR UPDATE USING (user_id=nullif(current_setting('app.current_user_id',true),'')::uuid) WITH CHECK (user_id=nullif(current_setting('app.current_user_id',true),'')::uuid);
CREATE POLICY provider_connections_delete_policy ON provider_connections FOR DELETE USING (user_id=nullif(current_setting('app.current_user_id',true),'')::uuid);
