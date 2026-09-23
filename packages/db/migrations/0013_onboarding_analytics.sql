-- Alpha onboarding state plus privacy-safe product analytics.
-- Onboarding columns live on users so status is one row lookup, not a join.
-- Analytics events carry counts, ids, and decisions only: bodies, transcripts,
-- and contact detail are rejected in application code before insert.
ALTER TABLE users ADD COLUMN onboarding_goal text;
ALTER TABLE users ADD COLUMN onboarding_started_at timestamptz;
ALTER TABLE users ADD COLUMN onboarding_completed_at timestamptz;
ALTER TABLE users ADD CONSTRAINT users_onboarding_goal CHECK (
 onboarding_goal IS NULL OR onboarding_goal IN ('organize','living-profile','remember-people','explore-history')
);
ALTER TABLE users ADD CONSTRAINT users_onboarding_timeline CHECK (
 (onboarding_started_at IS NULL AND onboarding_completed_at IS NULL)
 OR (onboarding_started_at IS NOT NULL AND (onboarding_completed_at IS NULL OR onboarding_completed_at >= onboarding_started_at))
);
CREATE TABLE analytics_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 event_name text NOT NULL,
 metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX analytics_events_user_created_idx ON analytics_events(user_id,created_at);
CREATE INDEX analytics_events_name_created_idx ON analytics_events(event_name,created_at);
ALTER TABLE analytics_events ENABLE ROW LEVEL SECURITY; ALTER TABLE analytics_events FORCE ROW LEVEL SECURITY;
CREATE POLICY analytics_events_owner_select_policy ON analytics_events FOR SELECT USING (user_id=nullif(current_setting('app.current_user_id',true),'')::uuid);
CREATE POLICY analytics_events_insert_policy ON analytics_events FOR INSERT WITH CHECK (user_id=nullif(current_setting('app.current_user_id',true),'')::uuid);
CREATE POLICY analytics_events_update_policy ON analytics_events FOR UPDATE USING (user_id=nullif(current_setting('app.current_user_id',true),'')::uuid) WITH CHECK (user_id=nullif(current_setting('app.current_user_id',true),'')::uuid);
CREATE POLICY analytics_events_delete_policy ON analytics_events FOR DELETE USING (user_id=nullif(current_setting('app.current_user_id',true),'')::uuid);
