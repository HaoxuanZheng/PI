CREATE TYPE ai_validation_status AS ENUM ('VALID', 'INVALID');
CREATE TYPE ai_user_decision AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED', 'MODIFIED', 'EXPIRED');
CREATE TABLE ai_operations (
 id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT, operation_type text NOT NULL,
 instruction text, target_object_id uuid NOT NULL REFERENCES objects(id) ON DELETE RESTRICT,
 target_revision_id uuid NOT NULL REFERENCES object_revisions(id) ON DELETE RESTRICT,
 permitted_context_ids jsonb NOT NULL, retrieved_context_manifest jsonb NOT NULL,
 provider text NOT NULL, model text NOT NULL, prompt_version text NOT NULL,
 structured_output jsonb NOT NULL, validation_status ai_validation_status NOT NULL,
 user_decision ai_user_decision NOT NULL DEFAULT 'PENDING', accepted_patch jsonb,
 created_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz,
 CONSTRAINT ai_operations_target_revision_fk FOREIGN KEY (target_object_id, target_revision_id) REFERENCES object_revisions(object_id, id) ON DELETE RESTRICT,
 CONSTRAINT ai_operations_context_array CHECK (jsonb_typeof(permitted_context_ids) = 'array'),
 CONSTRAINT ai_operations_proposal_identity CHECK (structured_output->>'operationId' = id::text AND structured_output->'target'->>'objectId' = target_object_id::text AND structured_output->'target'->>'baseRevisionId' = target_revision_id::text),
 CONSTRAINT ai_operations_instruction_length CHECK (instruction IS NULL OR char_length(instruction) <= 10000),
 CONSTRAINT ai_operations_valid_pending CHECK (validation_status = 'VALID'),
 CONSTRAINT ai_operations_decision_completion CHECK ((user_decision = 'PENDING' AND completed_at IS NULL) OR (user_decision <> 'PENDING' AND completed_at IS NOT NULL)),
 CONSTRAINT ai_operations_accepted_patch_check CHECK ((user_decision = 'ACCEPTED' AND accepted_patch IS NOT NULL) OR (user_decision <> 'ACCEPTED' AND accepted_patch IS NULL))
);
CREATE INDEX ai_operations_user_created_idx ON ai_operations (user_id, created_at DESC);
CREATE INDEX ai_operations_target_created_idx ON ai_operations (target_object_id, created_at DESC);
ALTER TABLE ai_operations ENABLE ROW LEVEL SECURITY; ALTER TABLE ai_operations FORCE ROW LEVEL SECURITY;
CREATE POLICY ai_operations_select_policy ON ai_operations FOR SELECT USING (user_id = nullif(current_setting('app.current_user_id', true), '')::uuid);
CREATE POLICY ai_operations_insert_policy ON ai_operations FOR INSERT WITH CHECK (user_id = nullif(current_setting('app.current_user_id', true), '')::uuid AND user_decision = 'PENDING' AND validation_status = 'VALID' AND EXISTS (SELECT 1 FROM objects target WHERE target.id = target_object_id AND (target.owner_id = user_id OR EXISTS (SELECT 1 FROM permissions p WHERE p.resource_type = 'OBJECT' AND p.resource_id = target.id AND p.revoked_at IS NULL AND p.principal_type = 'USER' AND p.principal_id = user_id::text AND p.capability IN ('EDIT','COLLABORATE','ADMIN')))));
CREATE POLICY ai_operations_update_policy ON ai_operations FOR UPDATE USING (user_id = nullif(current_setting('app.current_user_id', true), '')::uuid) WITH CHECK (user_id = nullif(current_setting('app.current_user_id', true), '')::uuid);
CREATE FUNCTION prevent_ai_operation_core_change() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF (NEW.id, NEW.user_id, NEW.operation_type, NEW.instruction, NEW.target_object_id, NEW.target_revision_id, NEW.permitted_context_ids, NEW.retrieved_context_manifest, NEW.provider, NEW.model, NEW.prompt_version, NEW.structured_output, NEW.validation_status, NEW.created_at) IS DISTINCT FROM (OLD.id, OLD.user_id, OLD.operation_type, OLD.instruction, OLD.target_object_id, OLD.target_revision_id, OLD.permitted_context_ids, OLD.retrieved_context_manifest, OLD.provider, OLD.model, OLD.prompt_version, OLD.structured_output, OLD.validation_status, OLD.created_at) THEN RAISE EXCEPTION 'AI operation proposal metadata is immutable' USING ERRCODE = '55000'; END IF; RETURN NEW; END; $$;
CREATE TRIGGER ai_operations_core_immutable BEFORE UPDATE ON ai_operations FOR EACH ROW EXECUTE FUNCTION prevent_ai_operation_core_change();
