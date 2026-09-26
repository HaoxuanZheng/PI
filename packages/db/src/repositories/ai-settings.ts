import { eq, sql as statement } from "drizzle-orm";
import { openToken, parseTokenKey, sealToken, type SealedToken } from "@lifegraph/connections";
import type { DatabaseClient } from "../index";
import { aiProviderSettings, auditLogs, users } from "../schema";

export type AISettingsInput = { apiKey: string; baseUrl: string; chatModel: string; embeddingModel: string };
export type AISettingsSummary = { configured: boolean; baseUrl?: string; chatModel?: string; embeddingModel?: string; updatedAt?: string };

function encryptionKey() { return parseTokenKey(process.env.OAUTH_TOKEN_KEY); }
function clean(input: AISettingsInput): AISettingsInput {
  const baseUrl = input.baseUrl.trim().replace(/\/+$/, "");
  const parsed = new URL(baseUrl);
  if (parsed.protocol !== "https:" && parsed.hostname !== "localhost") throw new Error("AI base URL must use HTTPS");
  const apiKey = input.apiKey.trim(), chatModel = input.chatModel.trim(), embeddingModel = input.embeddingModel.trim();
  if (!apiKey || apiKey.length > 8000 || !chatModel || !embeddingModel) throw new Error("AI settings are incomplete");
  return { apiKey, baseUrl, chatModel, embeddingModel };
}

export function createAISettingsRepository(client: DatabaseClient) {
  return {
    async summary(ownerId: string): Promise<AISettingsSummary> {
      return client.db.transaction(async tx => {
        await tx.execute(statement`select set_config('app.current_user_id', ${ownerId}, true)`);
        const [row] = await tx.select().from(aiProviderSettings).where(eq(aiProviderSettings.userId, ownerId)).limit(1);
        return row ? { configured: true, baseUrl: row.baseUrl, chatModel: row.chatModel, embeddingModel: row.embeddingModel, updatedAt: row.updatedAt.toISOString() } : { configured: false };
      });
    },
    async save(ownerId: string, raw: AISettingsInput, requestId?: string): Promise<void> {
      const input = clean(raw), sealedApiKey = sealToken(encryptionKey(), input.apiKey), now = new Date();
      await client.db.transaction(async tx => {
        await tx.execute(statement`select set_config('app.current_user_id', ${ownerId}, true)`);
        const [user] = await tx.select({ id: users.id }).from(users).where(eq(users.id, ownerId)).limit(1);
        if (!user) throw new Error("Account not found");
        await tx.insert(aiProviderSettings).values({ userId: ownerId, sealedApiKey, baseUrl: input.baseUrl, chatModel: input.chatModel, embeddingModel: input.embeddingModel, updatedAt: now }).onConflictDoUpdate({ target: aiProviderSettings.userId, set: { sealedApiKey, baseUrl: input.baseUrl, chatModel: input.chatModel, embeddingModel: input.embeddingModel, updatedAt: now } });
        await tx.insert(auditLogs).values({ actorUserId: ownerId, actorType: "USER", action: "AI_PROVIDER_CONFIGURED", resourceType: "ACCOUNT", resourceId: ownerId, requestId, metadata: { baseUrl: input.baseUrl, chatModel: input.chatModel, embeddingModel: input.embeddingModel } });
      });
    },
    async live(ownerId: string): Promise<AISettingsInput | null> {
      return client.db.transaction(async tx => {
        await tx.execute(statement`select set_config('app.current_user_id', ${ownerId}, true)`);
        const [row] = await tx.select().from(aiProviderSettings).where(eq(aiProviderSettings.userId, ownerId)).limit(1);
        return row ? { apiKey: openToken(encryptionKey(), row.sealedApiKey as SealedToken), baseUrl: row.baseUrl, chatModel: row.chatModel, embeddingModel: row.embeddingModel } : null;
      });
    },
    async remove(ownerId: string): Promise<void> {
      await client.db.transaction(async tx => { await tx.execute(statement`select set_config('app.current_user_id', ${ownerId}, true)`); await tx.delete(aiProviderSettings).where(eq(aiProviderSettings.userId, ownerId)); });
    }
  };
}
