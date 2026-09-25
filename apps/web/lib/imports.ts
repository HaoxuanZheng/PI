import { parseServerEnv } from "@lifegraph/config";
import { ConnectionCryptoError } from "@lifegraph/connections";
import { ConnectionNotFoundError } from "@lifegraph/db";
import type { ImportProvider, ImportProviderName } from "@lifegraph/imports";
import { createGoogleContactsProvider } from "@lifegraph/imports/google-contacts";
import { createGoogleDriveProvider } from "@lifegraph/imports/google-drive";
import { createNotionProvider } from "@lifegraph/imports/notion";
import { getConnectionRepository } from "./db";

export class ImportProviderUnavailableError extends Error { readonly code = "IMPORT_PROVIDER_UNAVAILABLE"; }

function operatorProvider(provider: ImportProviderName): ImportProvider {
  const env = parseServerEnv(process.env);
  if (provider === "GOOGLE_DRIVE") {
    if (!env.GOOGLE_DRIVE_ACCESS_TOKEN) throw new ImportProviderUnavailableError("GOOGLE_DRIVE_ACCESS_TOKEN is not configured");
    return createGoogleDriveProvider({ accessToken: env.GOOGLE_DRIVE_ACCESS_TOKEN });
  }
  if (provider === "GOOGLE_CONTACTS") {
    if (!env.GOOGLE_CONTACTS_ACCESS_TOKEN) throw new ImportProviderUnavailableError("GOOGLE_CONTACTS_ACCESS_TOKEN is not configured");
    return createGoogleContactsProvider({ accessToken: env.GOOGLE_CONTACTS_ACCESS_TOKEN });
  }
  if (provider === "NOTION") {
    if (!env.NOTION_API_TOKEN) throw new ImportProviderUnavailableError("NOTION_API_TOKEN is not configured");
    return createNotionProvider({ apiToken: env.NOTION_API_TOKEN });
  }
  throw new ImportProviderUnavailableError(`The ${provider} importer is not implemented yet`);
}

/**
 * Resolves a read-only provider adapter. A live user connection wins over
 * the operator token; absent, expired, or undecryptable connections fall
 * back explicitly rather than sending dead tokens.
 */
export function getImportProvider(provider: ImportProviderName): ImportProvider {
  return operatorProvider(provider);
}

export async function getImportProviderFor(actorId: string, provider: ImportProviderName): Promise<ImportProvider> {
  try {
    const live = await getConnectionRepository().liveToken(actorId, provider);
    if (provider === "GOOGLE_DRIVE") return createGoogleDriveProvider({ accessToken: live.accessToken });
    if (provider === "GOOGLE_CONTACTS") return createGoogleContactsProvider({ accessToken: live.accessToken });
    return createNotionProvider({ apiToken: live.accessToken });
  } catch (error) {
    // Absent, expired, or undecryptable connections fall back explicitly;
    // anything else is a real failure and propagates.
    if (error instanceof ConnectionNotFoundError || error instanceof ConnectionCryptoError) {
      return operatorProvider(provider);
    }
    throw error;
  }
}
