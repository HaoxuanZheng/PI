import { parseServerEnv } from "@lifegraph/config";
import { createInMemoryStorage, type StoragePort } from "@lifegraph/storage";
import { createSupabaseStorage } from "@lifegraph/storage/supabase";

const globalStorage = globalThis as typeof globalThis & { lifeGraphStorage?: StoragePort };

/**
 * Supabase Storage is used whenever a service-role key is configured. Development without one
 * falls back to an in-process adapter so the upload contract stays exercisable offline.
 */
export function getStoragePort() {
  if (!globalStorage.lifeGraphStorage) {
    const env = parseServerEnv(process.env);
    globalStorage.lifeGraphStorage = env.SUPABASE_SERVICE_ROLE_KEY
      ? createSupabaseStorage({
        url: env.NEXT_PUBLIC_SUPABASE_URL,
        serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY,
        bucket: env.STORAGE_BUCKET
      })
      : createInMemoryStorage();
  }
  return globalStorage.lifeGraphStorage;
}

export function storageRequiresCleanScan() {
  return parseServerEnv(process.env).STORAGE_REQUIRE_SCAN;
}
