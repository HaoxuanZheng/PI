CREATE TABLE embedding_chunks (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), owner_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 object_id uuid NOT NULL REFERENCES objects(id) ON DELETE RESTRICT, source_revision_id uuid NOT NULL REFERENCES object_revisions(id) ON DELETE RESTRICT,
 chunk_index integer NOT NULL, content text NOT NULL, content_hash text NOT NULL, embedding vector(1536) NOT NULL, metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
 created_at timestamptz NOT NULL DEFAULT now(), deleted_at timestamptz,
 CONSTRAINT embedding_chunks_revision_fk FOREIGN KEY (object_id, source_revision_id) REFERENCES object_revisions(object_id,id) ON DELETE RESTRICT,
 CONSTRAINT embedding_chunks_content_limit CHECK (char_length(content) BETWEEN 1 AND 20000), CONSTRAINT embedding_chunks_index_nonnegative CHECK (chunk_index >= 0)
);
CREATE UNIQUE INDEX embedding_chunks_revision_index_uidx ON embedding_chunks(object_id,source_revision_id,chunk_index);
CREATE INDEX embedding_chunks_active_object_idx ON embedding_chunks(object_id,source_revision_id) WHERE deleted_at IS NULL;
CREATE INDEX embedding_chunks_vector_hnsw_idx ON embedding_chunks USING hnsw (embedding vector_cosine_ops) WHERE deleted_at IS NULL;
ALTER TABLE embedding_chunks ENABLE ROW LEVEL SECURITY; ALTER TABLE embedding_chunks FORCE ROW LEVEL SECURITY;
CREATE POLICY embedding_chunks_select_policy ON embedding_chunks FOR SELECT USING (deleted_at IS NULL AND EXISTS (SELECT 1 FROM objects o WHERE o.id=object_id AND o.deleted_at IS NULL AND o.current_revision_id=source_revision_id AND (o.owner_id=nullif(current_setting('app.current_user_id',true),'')::uuid OR EXISTS (SELECT 1 FROM permissions p WHERE p.resource_type='OBJECT' AND p.resource_id=o.id AND p.revoked_at IS NULL AND p.principal_type='USER' AND p.principal_id=nullif(current_setting('app.current_user_id',true),'') AND p.capability IN ('READ','COMMENT','EDIT','COLLABORATE','SHARE','ADMIN')))));
CREATE POLICY embedding_chunks_insert_policy ON embedding_chunks FOR INSERT WITH CHECK (owner_id=nullif(current_setting('app.current_user_id',true),'')::uuid AND EXISTS (SELECT 1 FROM objects o WHERE o.id=object_id AND o.owner_id=owner_id AND o.current_revision_id=source_revision_id AND o.deleted_at IS NULL));
CREATE POLICY embedding_chunks_update_policy ON embedding_chunks FOR UPDATE USING (owner_id=nullif(current_setting('app.current_user_id',true),'')::uuid) WITH CHECK (owner_id=nullif(current_setting('app.current_user_id',true),'')::uuid);
CREATE POLICY embedding_chunks_delete_policy ON embedding_chunks FOR DELETE USING (owner_id=nullif(current_setting('app.current_user_id',true),'')::uuid);
CREATE FUNCTION invalidate_object_embeddings() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.current_revision_id IS DISTINCT FROM OLD.current_revision_id OR NEW.deleted_at IS DISTINCT FROM OLD.deleted_at THEN UPDATE embedding_chunks SET deleted_at=COALESCE(deleted_at,now()) WHERE object_id=NEW.id AND deleted_at IS NULL AND (NEW.deleted_at IS NOT NULL OR source_revision_id IS DISTINCT FROM NEW.current_revision_id); END IF; RETURN NEW; END; $$;
CREATE TRIGGER objects_invalidate_embeddings AFTER UPDATE OF current_revision_id,deleted_at ON objects FOR EACH ROW EXECUTE FUNCTION invalidate_object_embeddings();
