import type { ObjectSnapshot } from "@lifegraph/domain";
import { z } from "zod";
import {
  ImportValidationError,
  hashImportContent,
  normalizedImportItemSchema,
  type ImportBatch,
  type ImportManifest,
  type ImportProvider,
  type NormalizedImportItem
} from "./index";

export class ImportProviderError extends Error { readonly code = "IMPORT_PROVIDER_ERROR"; }

const GOOGLE_DOC = "application/vnd.google-apps.document";

/** Drive types we map to text. Anything else becomes a metadata-only record. */
const textLikeMimeTypes = new Set(["text/plain", "text/markdown", "text/csv"]);

export const driveFileSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  mimeType: z.string().min(1),
  modifiedTime: z.string().min(1).nullable().optional(),
  webViewLink: z.string().nullable().optional(),
  parents: z.array(z.string()).nullable().optional(),
  trashed: z.boolean().nullable().optional()
});

export type DriveFile = z.infer<typeof driveFileSchema>;

const driveListSchema = z.object({
  files: z.array(driveFileSchema).default([]),
  nextPageToken: z.string().nullable().optional()
});

export function driveObjectType(mimeType: string): ObjectSnapshot["type"] {
  if (mimeType === GOOGLE_DOC || textLikeMimeTypes.has(mimeType)) return "NOTE";
  if (mimeType.startsWith("image/")) return "PHOTO";
  if (mimeType.startsWith("audio/")) return "VOICE_NOTE";
  return "FILE";
}

export function isDriveTextual(mimeType: string) {
  return mimeType === GOOGLE_DOC || textLikeMimeTypes.has(mimeType);
}

/**
 * Maps one Drive file onto a snapshot. Pure, so idempotency and hashing are testable offline.
 *
 * Raw provider metadata is preserved under `customFields.source` for future migration debugging,
 * and never mapped into any field a public projection would read.
 */
export function normalizeDriveFile(file: DriveFile, options: { body?: string | null; folderPath?: string | null } = {}): NormalizedImportItem {
  const parsed = driveFileSchema.parse(file);
  const body = options.body?.trim() ? options.body : null;
  const snapshot: ObjectSnapshot = {
    schemaVersion: 1,
    type: driveObjectType(parsed.mimeType),
    title: parsed.name.slice(0, 300),
    tags: [],
    ...(body ? { body: { format: "plain_text" as const, content: body.slice(0, 1_000_000) } } : {}),
    customFields: {
      source: {
        provider: "GOOGLE_DRIVE",
        externalId: parsed.id,
        mimeType: parsed.mimeType,
        folderPath: options.folderPath ?? null,
        webViewLink: parsed.webViewLink ?? null,
        modifiedTime: parsed.modifiedTime ?? null
      }
    }
  };

  return normalizedImportItemSchema.parse({
    sourceExternalId: parsed.id,
    sourceModifiedAt: normalizeTimestamp(parsed.modifiedTime ?? null),
    // The hash covers the mapped content, so a Drive-side edit changes it and a no-op sync does not.
    contentHash: hashImportContent({ name: parsed.name, mimeType: parsed.mimeType, body, folderPath: options.folderPath ?? null }),
    snapshot
  });
}

function normalizeTimestamp(value: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new ImportValidationError("Drive returned an unparseable modifiedTime");
  return date.toISOString();
}

export type DriveTransport = (url: string, init: { headers: Record<string, string> }) => Promise<{ ok: boolean; status: number; text: () => Promise<string> }>;

/**
 * Read-only Google Drive provider.
 *
 * V0.11 accepts an already-obtained access token: the OAuth consent flow and refresh-token storage
 * are a separate concern and are not implemented here. Import is one-directional; nothing is ever
 * written back to Drive.
 */
export function createGoogleDriveProvider(config: {
  accessToken: string;
  pageSize?: number;
  transport?: DriveTransport;
}): ImportProvider {
  if (!config.accessToken.trim()) throw new ImportValidationError("A Google Drive access token is required");
  const pageSize = Math.min(Math.max(config.pageSize ?? 50, 1), 100);
  const transport: DriveTransport = config.transport ?? ((url, init) => fetch(url, init));
  const headers = { authorization: `Bearer ${config.accessToken}`, accept: "application/json" };

  async function request(url: string) {
    const response = await transport(url, { headers });
    const body = await response.text();
    if (!response.ok) throw new ImportProviderError(`Google Drive request failed with status ${response.status}`);
    return body;
  }

  const supported = [GOOGLE_DOC, ...textLikeMimeTypes, "application/pdf"].map((type) => `mimeType='${type}'`).join(" or ");
  const query = encodeURIComponent(`trashed=false and (${supported})`);

  return {
    provider: "GOOGLE_DRIVE",

    async discover(): Promise<ImportManifest> {
      return { provider: "GOOGLE_DRIVE", estimatedItems: null, scopes: ["https://www.googleapis.com/auth/drive.readonly"] };
    },

    async fetchBatch(cursor?: string | null): Promise<ImportBatch> {
      const page = cursor ? `&pageToken=${encodeURIComponent(cursor)}` : "";
      const listed = driveListSchema.parse(JSON.parse(await request(
        `https://www.googleapis.com/drive/v3/files?q=${query}&pageSize=${pageSize}&fields=nextPageToken,files(id,name,mimeType,modifiedTime,webViewLink,parents,trashed)${page}`
      )));

      const items: NormalizedImportItem[] = [];
      for (const file of listed.files) {
        if (file.trashed) continue;
        let body: string | null = null;
        if (isDriveTextual(file.mimeType)) {
          body = file.mimeType === GOOGLE_DOC
            ? await request(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(file.id)}/export?mimeType=text/plain`)
            : await request(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(file.id)}?alt=media`);
        }
        items.push(normalizeDriveFile(file, { body }));
      }

      return { items, nextCursor: listed.nextPageToken ?? null };
    }
  };
}
