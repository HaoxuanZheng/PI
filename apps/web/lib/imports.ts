import { parseServerEnv } from "@lifegraph/config";
import type { ImportProvider, ImportProviderName } from "@lifegraph/imports";
import { createGoogleDriveProvider } from "@lifegraph/imports/google-drive";

export class ImportProviderUnavailableError extends Error { readonly code = "IMPORT_PROVIDER_UNAVAILABLE"; }

/**
 * Resolves a read-only provider adapter. Only Google Drive is implemented in V0.11; Notion and
 * Google Contacts are declared in the contract but not yet available.
 */
export function getImportProvider(provider: ImportProviderName): ImportProvider {
  const env = parseServerEnv(process.env);
  if (provider !== "GOOGLE_DRIVE") {
    throw new ImportProviderUnavailableError(`The ${provider} importer is not implemented yet`);
  }
  if (!env.GOOGLE_DRIVE_ACCESS_TOKEN) {
    throw new ImportProviderUnavailableError("GOOGLE_DRIVE_ACCESS_TOKEN is not configured");
  }
  return createGoogleDriveProvider({ accessToken: env.GOOGLE_DRIVE_ACCESS_TOKEN });
}
