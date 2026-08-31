import { parseServerEnv } from "@lifegraph/config";
import type { ImportProvider, ImportProviderName } from "@lifegraph/imports";
import { createGoogleContactsProvider } from "@lifegraph/imports/google-contacts";
import { createGoogleDriveProvider } from "@lifegraph/imports/google-drive";
import { createNotionProvider } from "@lifegraph/imports/notion";

export class ImportProviderUnavailableError extends Error { readonly code = "IMPORT_PROVIDER_UNAVAILABLE"; }

/**
 * Resolves a read-only provider adapter. Google Drive, Google Contacts, and Notion are implemented.
 * All three are read-only and accept an operator-supplied token.
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
  if (provider === "NOTION") {
    if (!env.NOTION_API_TOKEN) throw new ImportProviderUnavailableError("NOTION_API_TOKEN is not configured");
    return createNotionProvider({ apiToken: env.NOTION_API_TOKEN });
  }
  throw new ImportProviderUnavailableError(`The ${provider} importer is not implemented yet`);
}
