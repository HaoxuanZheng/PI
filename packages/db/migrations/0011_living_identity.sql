CREATE TYPE publication_type AS ENUM ('PROFILE','PROFESSIONAL','OBJECT');
CREATE TYPE publication_status AS ENUM ('PUBLISHED','UNPUBLISHED');
-- Public reads come from here and nowhere else. `public_snapshot` is an authorized projection
-- containing only allowlisted fields, so no anonymous request ever touches objects or revisions.
CREATE TABLE publications (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), owner_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 source_object_id uuid REFERENCES objects(id) ON DELETE RESTRICT,
 -- The handle is denormalised from users.username on publish, so an anonymous read never needs to
 -- join users. users RLS is row level, not column level, so opening it to anonymous readers would
 -- expose email addresses alongside the username.
 handle text NOT NULL, slug text NOT NULL, publication_type publication_type NOT NULL,
 public_snapshot jsonb NOT NULL,
 published_revision_id uuid REFERENCES object_revisions(id) ON DELETE RESTRICT,
 status publication_status NOT NULL DEFAULT 'PUBLISHED',
 published_at timestamptz, updated_at timestamptz NOT NULL DEFAULT now(), unpublished_at timestamptz,
 -- An OBJECT publication always names its source and the exact revision it froze.
 CONSTRAINT publications_object_requires_source CHECK ((publication_type <> 'OBJECT') OR (source_object_id IS NOT NULL AND published_revision_id IS NOT NULL)),
 -- A profile is a view configuration over many objects, so it has no single source.
 CONSTRAINT publications_profile_has_no_source CHECK ((publication_type = 'OBJECT') OR source_object_id IS NULL),
 CONSTRAINT publications_status_timestamps CHECK ((status = 'PUBLISHED' AND published_at IS NOT NULL AND unpublished_at IS NULL) OR (status = 'UNPUBLISHED' AND unpublished_at IS NOT NULL)),
 CONSTRAINT publications_slug_shape CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,79}$'),
 CONSTRAINT publications_handle_shape CHECK (handle ~ '^[a-z0-9][a-z0-9_-]{2,29}$')
);
-- Slugs are unique per owner, so one user's page can never shadow another's.
CREATE UNIQUE INDEX publications_owner_slug_uidx ON publications(owner_id,slug);
-- At most one live profile and one live professional view per user.
CREATE UNIQUE INDEX publications_owner_profile_uidx ON publications(owner_id,publication_type) WHERE status='PUBLISHED' AND publication_type IN ('PROFILE','PROFESSIONAL');
-- The public lookup paths: /@handle/p/slug and /@handle.
CREATE UNIQUE INDEX publications_handle_slug_uidx ON publications(handle,slug);
CREATE INDEX publications_handle_status_idx ON publications(handle,publication_type,status);
CREATE INDEX publications_status_idx ON publications(status,publication_type);
CREATE INDEX publications_source_idx ON publications(source_object_id) WHERE source_object_id IS NOT NULL;
ALTER TABLE publications ENABLE ROW LEVEL SECURITY; ALTER TABLE publications FORCE ROW LEVEL SECURITY;
-- Anonymous readers may see published rows only. This is the one intentionally public read path in
-- the schema, and it exposes projections rather than canonical objects.
CREATE POLICY publications_public_select_policy ON publications FOR SELECT USING (status='PUBLISHED');
-- Owners additionally see their own unpublished rows so they can manage and re-publish them.
CREATE POLICY publications_owner_select_policy ON publications FOR SELECT USING (owner_id=nullif(current_setting('app.current_user_id',true),'')::uuid);
CREATE POLICY publications_insert_policy ON publications FOR INSERT WITH CHECK (owner_id=nullif(current_setting('app.current_user_id',true),'')::uuid AND (source_object_id IS NULL OR EXISTS (SELECT 1 FROM objects o WHERE o.id=publications.source_object_id AND o.owner_id=publications.owner_id AND o.deleted_at IS NULL)));
CREATE POLICY publications_update_policy ON publications FOR UPDATE USING (owner_id=nullif(current_setting('app.current_user_id',true),'')::uuid) WITH CHECK (owner_id=nullif(current_setting('app.current_user_id',true),'')::uuid);
CREATE POLICY publications_delete_policy ON publications FOR DELETE USING (owner_id=nullif(current_setting('app.current_user_id',true),'')::uuid);
-- Deleting an object must immediately stop serving anything published from it. Without this a
-- deleted record would remain publicly readable through its frozen projection.
CREATE FUNCTION unpublish_deleted_object() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.deleted_at IS DISTINCT FROM OLD.deleted_at AND NEW.deleted_at IS NOT NULL THEN UPDATE publications SET status='UNPUBLISHED', unpublished_at=COALESCE(unpublished_at,NEW.deleted_at), published_at=NULL, updated_at=now() WHERE source_object_id=NEW.id AND status='PUBLISHED'; END IF; RETURN NEW; END; $$;
CREATE TRIGGER objects_unpublish_on_delete AFTER UPDATE OF deleted_at ON objects FOR EACH ROW EXECUTE FUNCTION unpublish_deleted_object();
