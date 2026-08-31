CREATE TYPE file_category AS ENUM ('DOCUMENT','IMAGE','AUDIO');
CREATE TYPE file_upload_status AS ENUM ('PENDING','STORED');
CREATE TYPE file_scan_status AS ENUM ('PENDING','CLEAN','INFECTED','FAILED');
CREATE TYPE file_processing_status AS ENUM ('PENDING','READY','FAILED');
CREATE TABLE files (
 id uuid PRIMARY KEY, owner_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 object_id uuid NOT NULL REFERENCES objects(id) ON DELETE RESTRICT,
 storage_key text NOT NULL, original_filename text NOT NULL, mime_type text NOT NULL,
 category file_category NOT NULL, byte_size bigint NOT NULL, checksum text,
 upload_status file_upload_status NOT NULL DEFAULT 'PENDING', scan_status file_scan_status NOT NULL DEFAULT 'PENDING',
 processing_status file_processing_status NOT NULL DEFAULT 'PENDING',
 created_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz, deleted_at timestamptz,
 CONSTRAINT files_byte_size_limit CHECK (byte_size BETWEEN 1 AND 52428800),
 CONSTRAINT files_filename_limit CHECK (char_length(original_filename) BETWEEN 1 AND 255),
 -- Defence in depth: a storage key can never address bytes outside its owner's prefix.
 CONSTRAINT files_storage_key_owner_prefix CHECK (storage_key LIKE owner_id::text || '/%'),
 CONSTRAINT files_stored_requires_checksum CHECK ((upload_status = 'PENDING' AND checksum IS NULL AND completed_at IS NULL) OR (upload_status = 'STORED' AND checksum ~ '^[a-f0-9]{64}$' AND completed_at IS NOT NULL)),
 -- Bytes that were never confirmed as stored can never be reported as scanned or processed.
 CONSTRAINT files_scan_requires_stored CHECK (upload_status = 'STORED' OR scan_status = 'PENDING'),
 CONSTRAINT files_processing_requires_stored CHECK (upload_status = 'STORED' OR processing_status = 'PENDING')
);
CREATE UNIQUE INDEX files_storage_key_uidx ON files(storage_key);
CREATE INDEX files_object_created_idx ON files(object_id,created_at);
CREATE INDEX files_owner_created_idx ON files(owner_id,created_at);
CREATE UNIQUE INDEX files_object_checksum_uidx ON files(object_id,checksum) WHERE deleted_at IS NULL AND checksum IS NOT NULL;
ALTER TABLE files ENABLE ROW LEVEL SECURITY; ALTER TABLE files FORCE ROW LEVEL SECURITY;
-- The owner may also read their own soft-deleted rows, because deletion propagation must still be
-- able to read a storage key in order to remove the stored bytes. Grantees never see deleted rows,
-- and every application read path filters deleted_at explicitly.
CREATE POLICY files_select_policy ON files FOR SELECT USING (owner_id=nullif(current_setting('app.current_user_id',true),'')::uuid OR (deleted_at IS NULL AND EXISTS (SELECT 1 FROM objects o WHERE o.id=object_id AND o.deleted_at IS NULL AND EXISTS (SELECT 1 FROM permissions p WHERE p.resource_type='OBJECT' AND p.resource_id=o.id AND p.revoked_at IS NULL AND p.principal_type='USER' AND p.principal_id=nullif(current_setting('app.current_user_id',true),'') AND p.capability IN ('READ','COMMENT','EDIT','COLLABORATE','SHARE','ADMIN')))));
-- `files.owner_id` is qualified deliberately: an unqualified `owner_id` would resolve to the
-- subquery's own column and make the ownership comparison a tautology.
CREATE POLICY files_insert_policy ON files FOR INSERT WITH CHECK (owner_id=nullif(current_setting('app.current_user_id',true),'')::uuid AND EXISTS (SELECT 1 FROM objects o WHERE o.id=files.object_id AND o.owner_id=files.owner_id AND o.deleted_at IS NULL));
CREATE POLICY files_update_policy ON files FOR UPDATE USING (owner_id=nullif(current_setting('app.current_user_id',true),'')::uuid) WITH CHECK (owner_id=nullif(current_setting('app.current_user_id',true),'')::uuid);
CREATE POLICY files_delete_policy ON files FOR DELETE USING (owner_id=nullif(current_setting('app.current_user_id',true),'')::uuid);
-- Deleting an object removes its attachments from every read path, mirroring embedding invalidation.
CREATE FUNCTION invalidate_object_files() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.deleted_at IS DISTINCT FROM OLD.deleted_at AND NEW.deleted_at IS NOT NULL THEN UPDATE files SET deleted_at=COALESCE(deleted_at,NEW.deleted_at) WHERE object_id=NEW.id AND deleted_at IS NULL; END IF; RETURN NEW; END; $$;
CREATE TRIGGER objects_invalidate_files AFTER UPDATE OF deleted_at ON objects FOR EACH ROW EXECUTE FUNCTION invalidate_object_files();
