import { OpenAICompatibleProvider } from "@lifegraph/ai";
import { parseServerEnv } from "@lifegraph/config";
import { getAISettingsRepository } from "./db";

export class AIProviderNotConfiguredError extends Error {}

async function settingsFor(ownerId: string) {
  const env = parseServerEnv(process.env);
  const user = await getAISettingsRepository().live(ownerId);
  if (user) return user;
  if (!env.AI_API_KEY) throw new AIProviderNotConfiguredError("Add an AI provider in Settings before using AI features.");
  return { apiKey: env.AI_API_KEY, baseUrl: env.AI_BASE_URL, chatModel: env.AI_MODEL, embeddingModel: env.AI_EMBEDDING_MODEL };
}

export async function getAIProvider(ownerId: string) {
  const value = await settingsFor(ownerId);
  return new OpenAICompatibleProvider(value.chatModel, value.apiKey, value.baseUrl);
}
export async function getEmbeddingProvider(ownerId: string) {
  const value = await settingsFor(ownerId);
  return new OpenAICompatibleProvider(value.embeddingModel, value.apiKey, value.baseUrl, "openai-embeddings");
}
