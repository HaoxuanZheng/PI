ALTER TABLE object_revisions ADD CONSTRAINT object_revisions_ai_operation_fk FOREIGN KEY (ai_operation_id) REFERENCES ai_operations(id) ON DELETE RESTRICT;
CREATE UNIQUE INDEX object_revisions_ai_operation_uidx ON object_revisions (ai_operation_id) WHERE ai_operation_id IS NOT NULL;
