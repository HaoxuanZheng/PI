CREATE TABLE ai_provider_settings (
 user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 sealed_api_key jsonb NOT NULL,
 base_url text NOT NULL,
 chat_model text NOT NULL,
 embedding_model text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE ai_provider_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_provider_settings FORCE ROW LEVEL SECURITY;
CREATE POLICY ai_provider_settings_owner_select_policy ON ai_provider_settings FOR SELECT USING (user_id=nullif(current_setting('app.current_user_id',true),'')::uuid);
CREATE POLICY ai_provider_settings_insert_policy ON ai_provider_settings FOR INSERT WITH CHECK (user_id=nullif(current_setting('app.current_user_id',true),'')::uuid);
CREATE POLICY ai_provider_settings_update_policy ON ai_provider_settings FOR UPDATE USING (user_id=nullif(current_setting('app.current_user_id',true),'')::uuid) WITH CHECK (user_id=nullif(current_setting('app.current_user_id',true),'')::uuid);
CREATE POLICY ai_provider_settings_delete_policy ON ai_provider_settings FOR DELETE USING (user_id=nullif(current_setting('app.current_user_id',true),'')::uuid);
