import { personProfileSchema, type ObjectSnapshot } from "@lifegraph/domain";
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
import { ImportProviderError } from "./google-drive";

export const contactSchema = z.object({
  resourceName: z.string().min(1),
  names: z.array(z.object({ displayName: z.string().nullable().optional() })).nullable().optional(),
  emailAddresses: z.array(z.object({ value: z.string().nullable().optional() })).nullable().optional(),
  phoneNumbers: z.array(z.object({ value: z.string().nullable().optional() })).nullable().optional(),
  organizations: z.array(z.object({ name: z.string().nullable().optional(), title: z.string().nullable().optional() })).nullable().optional()
});

export type Contact = z.infer<typeof contactSchema>;

const connectionsSchema = z.object({
  connections: z.array(contactSchema).default([]),
  nextPageToken: z.string().nullable().optional()
});

function values(entries: ReadonlyArray<{ value?: string | null | undefined }> | null | undefined) {
  return (entries ?? []).map((entry) => entry.value?.trim()).filter((value): value is string => Boolean(value));
}

/**
 * Maps one Google contact onto a PERSON snapshot. Pure, so hashing and idempotency stay testable.
 *
 * Contact detail is written under `customFields.person` so entity resolution has validated fields
 * to compare. Raw provider metadata is preserved and never mapped into a public-facing field.
 */
export function normalizeContact(contact: Contact): NormalizedImportItem {
  const parsed = contactSchema.parse(contact);
  const organization = parsed.organizations?.[0];
  const displayName = parsed.names?.[0]?.displayName?.trim() || values(parsed.emailAddresses)[0];
  // A contact with neither a name nor an email cannot be identified, so it is rejected rather
  // than imported as an unnamed record the user cannot recognise.
  if (!displayName) throw new ImportValidationError("A contact requires a display name or an email address");

  const profile = personProfileSchema.parse({
    displayName: displayName.slice(0, 200),
    organization: organization?.name?.trim() || null,
    role: organization?.title?.trim() || null,
    emails: values(parsed.emailAddresses),
    phones: values(parsed.phoneNumbers),
    interests: []
  });

  const snapshot: ObjectSnapshot = {
    schemaVersion: 1,
    type: "PERSON",
    title: profile.displayName,
    tags: [],
    customFields: {
      person: profile,
      source: { provider: "GOOGLE_CONTACTS", externalId: parsed.resourceName }
    }
  };

  return normalizedImportItemSchema.parse({
    sourceExternalId: parsed.resourceName,
    sourceModifiedAt: null,
    contentHash: hashImportContent(profile),
    snapshot
  });
}

export type ContactsTransport = (url: string, init: { headers: Record<string, string> }) => Promise<{ ok: boolean; status: number; text: () => Promise<string> }>;

/**
 * Read-only Google Contacts provider.
 *
 * As with Drive, V0.12 accepts an already-obtained access token; the OAuth consent flow is not
 * implemented. Imported contacts are never public.
 */
export function createGoogleContactsProvider(config: {
  accessToken: string;
  pageSize?: number;
  transport?: ContactsTransport;
}): ImportProvider {
  if (!config.accessToken.trim()) throw new ImportValidationError("A Google Contacts access token is required");
  const pageSize = Math.min(Math.max(config.pageSize ?? 50, 1), 100);
  const transport: ContactsTransport = config.transport ?? ((url, init) => fetch(url, init));
  const headers = { authorization: `Bearer ${config.accessToken}`, accept: "application/json" };
  const fields = "names,emailAddresses,phoneNumbers,organizations";

  return {
    provider: "GOOGLE_CONTACTS",

    async discover(): Promise<ImportManifest> {
      return { provider: "GOOGLE_CONTACTS", estimatedItems: null, scopes: ["https://www.googleapis.com/auth/contacts.readonly"] };
    },

    async fetchBatch(cursor?: string | null): Promise<ImportBatch> {
      const page = cursor ? `&pageToken=${encodeURIComponent(cursor)}` : "";
      const response = await transport(
        `https://people.googleapis.com/v1/people/me/connections?personFields=${fields}&pageSize=${pageSize}${page}`,
        { headers }
      );
      const body = await response.text();
      if (!response.ok) throw new ImportProviderError(`Google Contacts request failed with status ${response.status}`);
      const listed = connectionsSchema.parse(JSON.parse(body));

      const items: NormalizedImportItem[] = [];
      for (const contact of listed.connections) {
        try {
          items.push(normalizeContact(contact));
        } catch (error) {
          // An unidentifiable contact is skipped rather than failing the whole page.
          if (!(error instanceof ImportValidationError)) throw error;
        }
      }

      return { items, nextCursor: listed.nextPageToken ?? null };
    }
  };
}
