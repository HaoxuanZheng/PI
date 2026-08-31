import { parseServerEnv } from "@lifegraph/config";
import type { ImportProvider, ImportProviderName } from "@lifegraph/imports";
import { createGoogleContactsProvider } from "@lifegraph/imports/google-contacts";
import { createGoogleDriveProvider } from "@lifegraph/imports/google-drive";

export class ImportProviderUnavailableError extends Error { readonly code = "IMPORT_PROVIDER_UNAVAILABLE"; }

/**
 * Resolves a read-only provider adapter. Google Drive and Google Contacts are implemented; Notion is
 * declared in the contract but not yet available.
 */
export function getImportProvider(provider: ImportProviderName): ImportProvider {
  const env = parseServerEnv(process.env);
  if (provider === "GOOGLE_DRIVE") {
    if (!env.GOOGLE_DRIVE_ACCESS_TOKEN) throw new ImportProviderUnavailableError("GOOGLE_DRIVE_ACCESS_TOKEN is not configured");
    return createGoogleDriveProvider({ accessToken: env.GOOGLE_DRIVE_ACCESS_TOKEN });
  }
  if (provider === "GOOGLE_CONTACTS") {
    if (!env.GOOGLE_CONTACTS_ACCESS_TOKEN) throw new ImportProviderUnavailableError("GOOGLE_CONTACTS_ACCESS_TOKEN is not configured");
    return createGoogleContactsProvider({ accessToken: env.GOOGLE_CONTACTS_ACCESS_TOKEN });
  }
  throw new ImportProviderUnavailableError(`The ${provider} importer is not implemented yet`);
}
