CREATE TYPE account_status AS ENUM ('ACTIVE', 'SUSPENDED', 'DELETION_PENDING');
CREATE TYPE object_type AS ENUM ('NOTE', 'IDEA', 'PROJECT', 'PERSON', 'EXPERIENCE', 'SKILL', 'FILE', 'PHOTO', 'VOICE_NOTE', 'EVENT', 'CREDENTIAL', 'GENERIC');
CREATE TYPE visibility AS ENUM ('PRIVATE', 'PUBLIC');
CREATE TYPE change_type AS ENUM ('CREATE', 'UPDATE', 'RESTORE', 'DELETE');
CREATE TYPE created_by_type AS ENUM ('USER', 'AI_ACCEPTED', 'IMPORT', 'SYSTEM_MIGRATION', 'RESTORE');

CREATE TABLE users (
  id uuid PRIMARY KEY,
  username text NOT NULL,
  display_name text,
  email text,
  timezone text NOT NULL DEFAULT 'UTC',
  locale text NOT NULL DEFAULT 'en-US',
  account_status account_status NOT NULL DEFAULT 'ACTIVE',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT users_username_format_check CHECK (username ~ '^[a-z0-9][a-z0-9_-]{2,29}$')
);

CREATE UNIQUE INDEX users_username_lower_uidx ON users (lower(username));

CREATE TABLE objects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  type object_type NOT NULL,
  title text,
  summary text,
  current_revision_id uuid,
  visibility visibility NOT NULL DEFAULT 'PRIVATE',
  observed_at timestamptz,
  effective_from timestamptz,
  effective_to timestamptz,
  source_type text,
  source_external_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  deleted_at timestamptz,
  CONSTRAINT objects_effective_range_check CHECK (effective_from IS NULL OR effective_to IS NULL OR effective_from <= effective_to)
);

CREATE INDEX objects_owner_updated_idx ON objects (owner_id, updated_at DESC);
CREATE INDEX objects_owner_type_idx ON objects (owner_id, type);

CREATE TABLE object_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  object_id uuid NOT NULL REFERENCES objects(id) ON DELETE RESTRICT,
  previous_revision_id uuid,
  snapshot jsonb NOT NULL,
  change_type change_type NOT NULL,
  created_by_type created_by_type NOT NULL,
  created_by_user_id uuid REFERENCES users(id) ON DELETE RESTRICT,
  ai_operation_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT object_revisions_snapshot_version_check CHECK ((snapshot->>'schemaVersion')::integer = 1),
  CONSTRAINT object_revisions_snapshot_type_check CHECK (snapshot->>'type' IS NOT NULL),
  UNIQUE (object_id, id),
  FOREIGN KEY (object_id, previous_revision_id) REFERENCES object_revisions(object_id, id) ON DELETE RESTRICT
);

ALTER TABLE objects
  ADD CONSTRAINT objects_current_revision_owner_fk
  FOREIGN KEY (id, current_revision_id)
  REFERENCES object_revisions(object_id, id)
  DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX object_revisions_object_created_idx ON object_revisions (object_id, created_at DESC);

CREATE FUNCTION reject_revision_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'object revisions are immutable' USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER object_revisions_immutable_update
  BEFORE UPDATE ON object_revisions
  FOR EACH ROW EXECUTE FUNCTION reject_revision_mutation();

CREATE TRIGGER object_revisions_immutable_delete
  BEFORE DELETE ON object_revisions
  FOR EACH ROW EXECUTE FUNCTION reject_revision_mutation();

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE objects ENABLE ROW LEVEL SECURITY;
ALTER TABLE object_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE users FORCE ROW LEVEL SECURITY;
ALTER TABLE objects FORCE ROW LEVEL SECURITY;
ALTER TABLE object_revisions FORCE ROW LEVEL SECURITY;

CREATE POLICY users_owner_policy ON users
  USING (id = nullif(current_setting('app.current_user_id', true), '')::uuid)
  WITH CHECK (id = nullif(current_setting('app.current_user_id', true), '')::uuid);

CREATE POLICY objects_owner_policy ON objects
  USING (owner_id = nullif(current_setting('app.current_user_id', true), '')::uuid)
  WITH CHECK (owner_id = nullif(current_setting('app.current_user_id', true), '')::uuid);

CREATE POLICY object_revisions_owner_policy ON object_revisions
  USING (EXISTS (
    SELECT 1 FROM objects
    WHERE objects.id = object_revisions.object_id
      AND objects.owner_id = nullif(current_setting('app.current_user_id', true), '')::uuid
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM objects
    WHERE objects.id = object_revisions.object_id
      AND objects.owner_id = nullif(current_setting('app.current_user_id', true), '')::uuid
  ));
