-- 0006 wrote this policy's owner check as `o.owner_id=owner_id`. PostgreSQL resolves the
-- unqualified `owner_id` to the subquery's own range table (`o`), so the condition collapsed to
-- the tautology `o.owner_id=o.owner_id` and never enforced that the chunk owner owns the object.
-- Qualify it as `embedding_chunks.owner_id` so the outer row's column is used. Every other
-- condition is unchanged. `files_insert_policy` in 0007 already uses the qualified form.
DROP POLICY embedding_chunks_insert_policy ON embedding_chunks;
CREATE POLICY embedding_chunks_insert_policy ON embedding_chunks FOR INSERT WITH CHECK (owner_id=nullif(current_setting('app.current_user_id',true),'')::uuid AND EXISTS (SELECT 1 FROM objects o WHERE o.id=object_id AND o.owner_id=embedding_chunks.owner_id AND o.current_revision_id=source_revision_id AND o.deleted_at IS NULL));
