-- Deletion pipeline: account deletion request window plus edge tombstoning on object delete.
-- Embeddings, files, and publications already invalidate via their own triggers (0006, 0007, 0011).
-- Edges were the missing cascade: a deleted object must not leave live relationships behind.
ALTER TYPE resource_type ADD VALUE 'ACCOUNT';
ALTER TABLE users ADD COLUMN deletion_requested_at timestamptz;
ALTER TABLE users ADD COLUMN deletion_purge_after timestamptz;
ALTER TABLE users ADD CONSTRAINT users_deletion_window CHECK (
 (deletion_requested_at IS NULL AND deletion_purge_after IS NULL AND account_status IN ('ACTIVE', 'SUSPENDED'))
 OR (deletion_requested_at IS NOT NULL AND deletion_purge_after IS NOT NULL AND deletion_purge_after >= deletion_requested_at AND account_status = 'DELETION_PENDING')
);
-- Defence in depth for the application-level tombstoning in softDelete: direct SQL updates to
-- objects.deleted_at still tombstone both directions of the edge.
CREATE FUNCTION tombstone_deleted_object_edges() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.deleted_at IS DISTINCT FROM OLD.deleted_at AND NEW.deleted_at IS NOT NULL THEN UPDATE object_relationships SET deleted_at=COALESCE(deleted_at,NEW.deleted_at) WHERE deleted_at IS NULL AND (source_object_id=NEW.id OR target_object_id=NEW.id); END IF; RETURN NEW; END; $$;
CREATE TRIGGER objects_tombstone_edges_on_delete AFTER UPDATE OF deleted_at ON objects FOR EACH ROW EXECUTE FUNCTION tombstone_deleted_object_edges();
