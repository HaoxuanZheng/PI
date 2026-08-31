CREATE TYPE entity_merge_status AS ENUM ('PENDING','MERGED','SEPARATE');
CREATE TYPE entity_match_confidence AS ENUM ('HIGH','MEDIUM','LOW');
-- A duplicate proposal, never an applied merge. Resolution is deterministic and always reviewed.
CREATE TABLE entity_merge_candidates (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), owner_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 left_object_id uuid NOT NULL REFERENCES objects(id) ON DELETE RESTRICT,
 right_object_id uuid NOT NULL REFERENCES objects(id) ON DELETE RESTRICT,
 score numeric(4,3) NOT NULL, confidence entity_match_confidence NOT NULL, signals jsonb NOT NULL,
 status entity_merge_status NOT NULL DEFAULT 'PENDING',
 created_at timestamptz NOT NULL DEFAULT now(), decided_at timestamptz,
 -- The pair is stored in a canonical order so one duplicate cannot be proposed twice as (a,b) and (b,a).
 CONSTRAINT entity_merge_candidates_ordered CHECK (left_object_id < right_object_id),
 CONSTRAINT entity_merge_candidates_score_range CHECK (score >= 0 AND score <= 1),
 CONSTRAINT entity_merge_candidates_decision_time CHECK ((status = 'PENDING' AND decided_at IS NULL) OR (status <> 'PENDING' AND decided_at IS NOT NULL))
);
-- One live proposal per pair. A decided pair is never re-proposed, so dismissals stay dismissed.
CREATE UNIQUE INDEX entity_merge_candidates_pair_uidx ON entity_merge_candidates(owner_id,left_object_id,right_object_id);
CREATE INDEX entity_merge_candidates_owner_status_idx ON entity_merge_candidates(owner_id,status,score);
ALTER TABLE entity_merge_candidates ENABLE ROW LEVEL SECURITY; ALTER TABLE entity_merge_candidates FORCE ROW LEVEL SECURITY;
CREATE POLICY entity_merge_candidates_select_policy ON entity_merge_candidates FOR SELECT USING (owner_id=nullif(current_setting('app.current_user_id',true),'')::uuid);
CREATE POLICY entity_merge_candidates_insert_policy ON entity_merge_candidates FOR INSERT WITH CHECK (owner_id=nullif(current_setting('app.current_user_id',true),'')::uuid AND EXISTS (SELECT 1 FROM objects o WHERE o.id=entity_merge_candidates.left_object_id AND o.owner_id=entity_merge_candidates.owner_id AND o.deleted_at IS NULL) AND EXISTS (SELECT 1 FROM objects o WHERE o.id=entity_merge_candidates.right_object_id AND o.owner_id=entity_merge_candidates.owner_id AND o.deleted_at IS NULL));
CREATE POLICY entity_merge_candidates_update_policy ON entity_merge_candidates FOR UPDATE USING (owner_id=nullif(current_setting('app.current_user_id',true),'')::uuid) WITH CHECK (owner_id=nullif(current_setting('app.current_user_id',true),'')::uuid);
CREATE POLICY entity_merge_candidates_delete_policy ON entity_merge_candidates FOR DELETE USING (owner_id=nullif(current_setting('app.current_user_id',true),'')::uuid);
-- Applied merges record the exact revisions on both sides, so every merge is auditable and carries
-- the state a future reversal would need.
CREATE TABLE entity_merges (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), owner_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 candidate_id uuid NOT NULL REFERENCES entity_merge_candidates(id) ON DELETE RESTRICT,
 target_object_id uuid NOT NULL REFERENCES objects(id) ON DELETE RESTRICT,
 source_object_id uuid NOT NULL REFERENCES objects(id) ON DELETE RESTRICT,
 target_revision_before uuid NOT NULL REFERENCES object_revisions(id) ON DELETE RESTRICT,
 target_revision_after uuid NOT NULL REFERENCES object_revisions(id) ON DELETE RESTRICT,
 source_revision_before uuid NOT NULL REFERENCES object_revisions(id) ON DELETE RESTRICT,
 created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT entity_merges_distinct_objects CHECK (target_object_id <> source_object_id)
);
CREATE UNIQUE INDEX entity_merges_candidate_uidx ON entity_merges(candidate_id);
CREATE INDEX entity_merges_owner_created_idx ON entity_merges(owner_id,created_at);
ALTER TABLE entity_merges ENABLE ROW LEVEL SECURITY; ALTER TABLE entity_merges FORCE ROW LEVEL SECURITY;
CREATE POLICY entity_merges_select_policy ON entity_merges FOR SELECT USING (owner_id=nullif(current_setting('app.current_user_id',true),'')::uuid);
CREATE POLICY entity_merges_insert_policy ON entity_merges FOR INSERT WITH CHECK (owner_id=nullif(current_setting('app.current_user_id',true),'')::uuid);
