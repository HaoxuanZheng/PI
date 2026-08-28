import { OpenAICompatibleProvider } from "@lifegraph/ai";
import { parseServerEnv } from "@lifegraph/config";

export function getAIProvider() {
  const env = parseServerEnv(process.env);
  if (!env.AI_API_KEY) throw new Error("AI_API_KEY is not configured");
  return new OpenAICompatibleProvider(env.AI_MODEL, env.AI_API_KEY, env.AI_BASE_URL);
}
export function getEmbeddingProvider(){const env=parseServerEnv(process.env);if(!env.AI_API_KEY)throw new Error("AI_API_KEY is not configured");return new OpenAICompatibleProvider(env.AI_EMBEDDING_MODEL,env.AI_API_KEY,env.AI_BASE_URL,"openai-embeddings");}
