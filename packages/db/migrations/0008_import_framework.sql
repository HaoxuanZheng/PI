CREATE TYPE import_provider AS ENUM ('GOOGLE_DRIVE','NOTION','GOOGLE_CONTACTS');
CREATE TYPE import_status AS ENUM ('PENDING','RUNNING','COMPLETED','FAILED');
-- Provenance for imported objects. `source_content_hash` is the idempotency signal: an unchanged
-- source re-imports to the same hash and is skipped instead of creating a duplicate or a revision.
ALTER TABLE objects ADD COLUMN source_content_hash text;
ALTER TABLE objects ADD COLUMN source_modified_at timestamptz;
-- One external record maps to at most one live object per owner and provider.
CREATE UNIQUE INDEX objects_owner_source_uidx ON objects(owner_id,source_type,source_external_id) WHERE deleted_at IS NULL AND source_type IS NOT NULL AND source_external_id IS NOT NULL;
CREATE TABLE imports (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 provider import_provider NOT NULL, status import_status NOT NULL DEFAULT 'PENDING',
 started_at timestamptz, completed_at timestamptz,
 imported_count integer NOT NULL DEFAULT 0, skipped_count integer NOT NULL DEFAULT 0, error_count integer NOT NULL DEFAULT 0,
 cursor_state jsonb, error_summary jsonb,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT imports_counts_nonnegative CHECK (imported_count >= 0 AND skipped_count >= 0 AND error_count >= 0),
 CONSTRAINT imports_terminal_completion CHECK ((status IN ('PENDING','RUNNING') AND completed_at IS NULL) OR (status IN ('COMPLETED','FAILED') AND completed_at IS NOT NULL))
);
CREATE INDEX imports_user_created_idx ON imports(user_id,created_at);
-- At most one live run per provider per user, so a double submit cannot fan out duplicate work.
CREATE UNIQUE INDEX imports_active_provider_uidx ON imports(user_id,provider) WHERE status IN ('PENDING','RUNNING');
ALTER TABLE imports ENABLE ROW LEVEL SECURITY; ALTER TABLE imports FORCE ROW LEVEL SECURITY;
CREATE POLICY imports_select_policy ON imports FOR SELECT USING (user_id=nullif(current_setting('app.current_user_id',true),'')::uuid);
CREATE POLICY imports_insert_policy ON imports FOR INSERT WITH CHECK (user_id=nullif(current_setting('app.current_user_id',true),'')::uuid);
CREATE POLICY imports_update_policy ON imports FOR UPDATE USING (user_id=nullif(current_setting('app.current_user_id',true),'')::uuid) WITH CHECK (user_id=nullif(current_setting('app.current_user_id',true),'')::uuid);
CREATE POLICY imports_delete_policy ON imports FOR DELETE USING (user_id=nullif(current_setting('app.current_user_id',true),'')::uuid);
