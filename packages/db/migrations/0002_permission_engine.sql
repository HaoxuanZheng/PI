CREATE TYPE capability AS ENUM ('READ', 'COMMENT', 'EDIT', 'COLLABORATE', 'SHARE', 'ADMIN');
CREATE TYPE principal_type AS ENUM ('USER', 'CONNECTION', 'GROUP', 'LINK', 'PUBLIC', 'SYSTEM_AI');
CREATE TYPE resource_type AS ENUM ('OBJECT');
CREATE TYPE actor_type AS ENUM ('USER', 'SYSTEM', 'SYSTEM_AI');

CREATE TABLE permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  resource_type resource_type NOT NULL,
  resource_id uuid NOT NULL,
  principal_type principal_type NOT NULL,
  principal_id text,
  capability capability NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  CONSTRAINT permissions_principal_id_check CHECK (
    (principal_type = 'PUBLIC' AND principal_id IS NULL)
    OR (principal_type <> 'PUBLIC' AND principal_id IS NOT NULL)
  )
);

CREATE INDEX permissions_resource_active_idx ON permissions (resource_type, resource_id, revoked_at);
CREATE UNIQUE INDEX permissions_active_grant_uidx
  ON permissions (resource_type, resource_id, principal_type, coalesce(principal_id, ''), capability)
  WHERE revoked_at IS NULL;

CREATE TABLE audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id uuid REFERENCES users(id) ON DELETE RESTRICT,
  actor_type actor_type NOT NULL,
  action text NOT NULL,
  resource_type resource_type,
  resource_id uuid,
  request_id text,
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX audit_logs_resource_created_idx ON audit_logs (resource_type, resource_id, created_at DESC);
CREATE INDEX audit_logs_actor_created_idx ON audit_logs (actor_user_id, created_at DESC);

CREATE FUNCTION prevent_object_owner_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.owner_id <> OLD.owner_id THEN
    RAISE EXCEPTION 'object owner is immutable' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER objects_owner_immutable
  BEFORE UPDATE OF owner_id ON objects
  FOR EACH ROW EXECUTE FUNCTION prevent_object_owner_change();

CREATE FUNCTION validate_object_permission_owner() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  actual_owner uuid;
BEGIN
  IF NEW.resource_type <> 'OBJECT' THEN
    RAISE EXCEPTION 'unsupported permission resource type' USING ERRCODE = '23514';
  END IF;
  SELECT owner_id INTO actual_owner FROM objects WHERE id = NEW.resource_id;
  IF actual_owner IS NULL OR actual_owner <> NEW.owner_id THEN
    RAISE EXCEPTION 'permission owner must own the object' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER permissions_owner_matches_resource
  BEFORE INSERT OR UPDATE OF owner_id, resource_type, resource_id ON permissions
  FOR EACH ROW EXECUTE FUNCTION validate_object_permission_owner();

DROP POLICY objects_owner_policy ON objects;
DROP POLICY object_revisions_owner_policy ON object_revisions;

CREATE POLICY objects_select_policy ON objects FOR SELECT
  USING (
    owner_id = nullif(current_setting('app.current_user_id', true), '')::uuid
    OR EXISTS (
      SELECT 1 FROM permissions p
      WHERE p.resource_type = 'OBJECT' AND p.resource_id = objects.id AND p.revoked_at IS NULL
        AND p.principal_type = 'USER' AND p.principal_id = current_setting('app.current_user_id', true)
    )
  );
CREATE POLICY objects_insert_policy ON objects FOR INSERT
  WITH CHECK (owner_id = nullif(current_setting('app.current_user_id', true), '')::uuid);
CREATE POLICY objects_update_policy ON objects FOR UPDATE
  USING (
    owner_id = nullif(current_setting('app.current_user_id', true), '')::uuid
    OR EXISTS (
      SELECT 1 FROM permissions p
      WHERE p.resource_type = 'OBJECT' AND p.resource_id = objects.id AND p.revoked_at IS NULL
        AND p.principal_type = 'USER' AND p.principal_id = current_setting('app.current_user_id', true)
        AND p.capability IN ('EDIT', 'COLLABORATE', 'ADMIN')
    )
  )
  WITH CHECK (
    owner_id = nullif(current_setting('app.current_user_id', true), '')::uuid
    OR EXISTS (
      SELECT 1 FROM permissions p
      WHERE p.resource_type = 'OBJECT' AND p.resource_id = objects.id AND p.revoked_at IS NULL
        AND p.principal_type = 'USER' AND p.principal_id = current_setting('app.current_user_id', true)
        AND p.capability IN ('EDIT', 'COLLABORATE', 'ADMIN')
    )
  );

CREATE POLICY object_revisions_select_policy ON object_revisions FOR SELECT
  USING (EXISTS (SELECT 1 FROM objects o WHERE o.id = object_revisions.object_id));
CREATE POLICY object_revisions_insert_policy ON object_revisions FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM objects o
    WHERE o.id = object_revisions.object_id
      AND (
        o.owner_id = nullif(current_setting('app.current_user_id', true), '')::uuid
        OR EXISTS (
          SELECT 1 FROM permissions p
          WHERE p.resource_type = 'OBJECT' AND p.resource_id = o.id AND p.revoked_at IS NULL
            AND p.principal_type = 'USER' AND p.principal_id = current_setting('app.current_user_id', true)
            AND p.capability IN ('EDIT', 'COLLABORATE', 'ADMIN')
        )
      )
  ));

ALTER TABLE permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE permissions FORCE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs FORCE ROW LEVEL SECURITY;

CREATE POLICY permissions_select_policy ON permissions FOR SELECT
  USING (
    owner_id = nullif(current_setting('app.current_user_id', true), '')::uuid
    OR (principal_type = 'USER' AND principal_id = current_setting('app.current_user_id', true))
  );
CREATE POLICY permissions_insert_policy ON permissions FOR INSERT
  WITH CHECK (owner_id = nullif(current_setting('app.current_user_id', true), '')::uuid);
CREATE POLICY permissions_update_policy ON permissions FOR UPDATE
  USING (owner_id = nullif(current_setting('app.current_user_id', true), '')::uuid)
  WITH CHECK (owner_id = nullif(current_setting('app.current_user_id', true), '')::uuid);

CREATE POLICY audit_logs_insert_policy ON audit_logs FOR INSERT
  WITH CHECK (actor_user_id = nullif(current_setting('app.current_user_id', true), '')::uuid);
CREATE POLICY audit_logs_select_policy ON audit_logs FOR SELECT
  USING (
    actor_user_id = nullif(current_setting('app.current_user_id', true), '')::uuid
    OR (resource_type = 'OBJECT' AND EXISTS (
      SELECT 1 FROM objects o
      WHERE o.id = audit_logs.resource_id
        AND o.owner_id = nullif(current_setting('app.current_user_id', true), '')::uuid
    ))
  );
