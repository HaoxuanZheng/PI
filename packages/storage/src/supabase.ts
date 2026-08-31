import { createClient } from "@supabase/supabase-js";
import {
  StorageValidationError,
  defaultDownloadExpirySeconds,
  defaultUploadExpirySeconds,
  expiresAt,
  storageKeyOwnerId,
  type StoragePort
} from "./index";

export class StorageProviderError extends Error { readonly code = "STORAGE_UNAVAILABLE"; }

/**
 * Supabase Storage adapter. The bucket must stay private: every read and write is a short-lived
 * signed URL, and the service-role key never reaches browser code.
 */
export function createSupabaseStorage(config: { url: string; serviceRoleKey: string; bucket: string }): StoragePort {
  const client = createClient(config.url, config.serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const bucket = () => client.storage.from(config.bucket);

  return {
    name: "supabase",

    async createUploadUrl({ key, mimeType, expiresInSeconds = defaultUploadExpirySeconds }) {
      if (!storageKeyOwnerId(key)) throw new StorageValidationError("Storage keys must be owner prefixed");
      const { data, error } = await bucket().createSignedUploadUrl(key);
      if (error || !data) throw new StorageProviderError(error?.message ?? "The upload URL could not be created");
      return {
        url: data.signedUrl,
        method: "PUT",
        headers: { "content-type": mimeType },
        token: data.token,
        expiresAt: expiresAt(expiresInSeconds)
      };
    },

    async createDownloadUrl({ key, expiresInSeconds = defaultDownloadExpirySeconds }) {
      const { data, error } = await bucket().createSignedUrl(key, expiresInSeconds);
      if (error || !data) throw new StorageProviderError(error?.message ?? "The download URL could not be created");
      return { url: data.signedUrl, expiresAt: expiresAt(expiresInSeconds) };
    },

    async remove(key) {
      const { error } = await bucket().remove([key]);
      if (error) throw new StorageProviderError(error.message);
    }
  };
}
