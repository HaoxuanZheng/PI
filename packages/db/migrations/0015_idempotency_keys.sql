-- Idempotency keys for retried POSTs: a client-generated key makes one logical
-- operation return the same stored response instead of executing twice.
-- Responses are recorded only when the handler succeeds; handler errors drop
-- the reservation so a retry proceeds. Expired rows are treated as absent.
CREATE TABLE idempotency_keys (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 idempotency_key text NOT NULL,
 method text NOT NULL,
 path text NOT NULL,
 status_code integer,
 response_body jsonb,
 created_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL
);
CREATE UNIQUE INDEX idempotency_keys_user_key_uidx ON idempotency_keys(user_id,idempotency_key);
CREATE INDEX idempotency_keys_expires_idx ON idempotency_keys(expires_at);
ALTER TABLE idempotency_keys ENABLE ROW LEVEL SECURITY; ALTER TABLE idempotency_keys FORCE ROW LEVEL SECURITY;
CREATE POLICY idempotency_keys_owner_select_policy ON idempotency_keys FOR SELECT USING (user_id=nullif(current_setting('app.current_user_id',true),'')::uuid);
CREATE POLICY idempotency_keys_insert_policy ON idempotency_keys FOR INSERT WITH CHECK (user_id=nullif(current_setting('app.current_user_id',true),'')::uuid);
CREATE POLICY idempotency_keys_update_policy ON idempotency_keys FOR UPDATE USING (user_id=nullif(current_setting('app.current_user_id',true),'')::uuid) WITH CHECK (user_id=nullif(current_setting('app.current_user_id',true),'')::uuid);
CREATE POLICY idempotency_keys_delete_policy ON idempotency_keys FOR DELETE USING (user_id=nullif(current_setting('app.current_user_id',true),'')::uuid);
