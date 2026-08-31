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

/** Pinned so a Notion API change cannot silently alter mapped content. */
export const notionApiVersion = "2022-06-28";

const richTextSchema = z.array(z.object({ plain_text: z.string().nullable().optional() })).nullable().optional();

export const notionPropertySchema = z.object({
  type: z.string().min(1),
  title: richTextSchema,
  rich_text: richTextSchema,
  email: z.string().nullable().optional(),
  phone_number: z.string().nullable().optional(),
  url: z.string().nullable().optional(),
  number: z.number().nullable().optional(),
  checkbox: z.boolean().nullable().optional(),
  select: z.object({ name: z.string().nullable().optional() }).nullable().optional(),
  multi_select: z.array(z.object({ name: z.string().nullable().optional() })).nullable().optional(),
  date: z.object({ start: z.string().nullable().optional() }).nullable().optional()
}).loose();

export const notionPageSchema = z.object({
  id: z.string().min(1),
  object: z.string().nullable().optional(),
  url: z.string().nullable().optional(),
  last_edited_time: z.string().nullable().optional(),
  archived: z.boolean().nullable().optional(),
  in_trash: z.boolean().nullable().optional(),
  parent: z.object({ type: z.string().nullable().optional(), database_id: z.string().nullable().optional(), page_id: z.string().nullable().optional() }).nullable().optional(),
  properties: z.record(z.string(), notionPropertySchema).nullable().optional()
});

export type NotionPage = z.infer<typeof notionPageSchema>;
export type NotionProperty = z.infer<typeof notionPropertySchema>;
export type NotionPropertyValue = string | number | boolean | string[] | null;

const searchSchema = z.object({
  results: z.array(notionPageSchema).default([]),
  next_cursor: z.string().nullable().optional(),
  has_more: z.boolean().nullable().optional()
});

const blocksSchema = z.object({
  results: z.array(z.object({
    type: z.string().min(1),
    paragraph: z.object({ rich_text: richTextSchema }).nullable().optional(),
    heading_1: z.object({ rich_text: richTextSchema }).nullable().optional(),
    heading_2: z.object({ rich_text: richTextSchema }).nullable().optional(),
    heading_3: z.object({ rich_text: richTextSchema }).nullable().optional(),
    bulleted_list_item: z.object({ rich_text: richTextSchema }).nullable().optional(),
    numbered_list_item: z.object({ rich_text: richTextSchema }).nullable().optional(),
    quote: z.object({ rich_text: richTextSchema }).nullable().optional()
  }).loose()).default([]),
  next_cursor: z.string().nullable().optional()
});

const textualBlockTypes = ["paragraph", "heading_1", "heading_2", "heading_3", "bulleted_list_item", "numbered_list_item", "quote"] as const;

function plainText(value: z.infer<typeof richTextSchema>) {
  return (value ?? []).map((entry) => entry.plain_text ?? "").join("").trim();
}

/** Flattens one Notion property to a comparable scalar, so property drift changes the content hash. */
export function notionPropertyValue(property: NotionProperty): NotionPropertyValue {
  switch (property.type) {
    case "title": return plainText(property.title) || null;
    case "rich_text": return plainText(property.rich_text) || null;
    case "email": return property.email ?? null;
    case "phone_number": return property.phone_number ?? null;
    case "url": return property.url ?? null;
    case "number": return property.number ?? null;
    case "checkbox": return property.checkbox ?? null;
    case "select": return property.select?.name ?? null;
    case "multi_select": return (property.multi_select ?? []).map((entry) => entry.name ?? "").filter(Boolean);
    case "date": return property.date?.start ?? null;
    // Unsupported property types are recorded as absent rather than guessed at.
    default: return null;
  }
}

export function notionPageTitle(page: NotionPage) {
  for (const property of Object.values(page.properties ?? {})) {
    if (property.type === "title") {
      const title = plainText(property.title);
      if (title) return title;
    }
  }
  return null;
}

function firstPropertyOfType(page: NotionPage, type: string) {
  for (const property of Object.values(page.properties ?? {})) {
    if (property.type === type) {
      const value = notionPropertyValue(property);
      if (typeof value === "string" && value.trim()) return value.trim();
    }
  }
  return null;
}

/**
 * A database page becomes a PERSON only when the database confidently describes one: it must have a
 * title and an email property with a value. Everything else becomes a NOTE. The specification asks
 * for a typed object "where confidently mapped", and an email is the signal that both justifies the
 * type and makes the record useful to entity resolution.
 */
export function notionObjectType(page: NotionPage): ObjectSnapshot["type"] {
  const fromDatabase = page.parent?.type === "database_id" && Boolean(page.parent.database_id);
  if (fromDatabase && firstPropertyOfType(page, "email")) return "PERSON";
  return "NOTE";
}

/**
 * Maps one Notion page onto a snapshot. Pure, so mapping and hashing stay testable offline.
 *
 * Raw parent, database, and property metadata is preserved under `customFields.source` for future
 * migration debugging, and is never mapped into a field a public projection reads.
 */
export function normalizeNotionPage(page: NotionPage, options: { body?: string | null } = {}): NormalizedImportItem {
  const parsed = notionPageSchema.parse(page);
  const title = notionPageTitle(parsed);
  const body = options.body?.trim() ? options.body : null;
  // An untitled page with no content cannot be recognised by the user, so it is not imported.
  if (!title && !body) throw new ImportValidationError("A Notion page requires a title or body content");

  const properties: Record<string, NotionPropertyValue> = {};
  for (const [name, property] of Object.entries(parsed.properties ?? {})) {
    properties[name] = notionPropertyValue(property);
  }

  const type = notionObjectType(parsed);
  const displayName = title ?? "Untitled Notion page";
  const source = {
    provider: "NOTION",
    externalId: parsed.id,
    url: parsed.url ?? null,
    parentType: parsed.parent?.type ?? null,
    databaseId: parsed.parent?.database_id ?? null,
    properties
  };

  const snapshot: ObjectSnapshot = {
    schemaVersion: 1,
    type,
    title: displayName.slice(0, 300),
    tags: [],
    ...(body ? { body: { format: "plain_text" as const, content: body.slice(0, 1_000_000) } } : {}),
    customFields: {
      source,
      ...(type === "PERSON"
        ? {
          person: personProfileSchema.parse({
            displayName: displayName.slice(0, 200),
            organization: firstPropertyOfType(parsed, "select"),
            role: null,
            emails: [firstPropertyOfType(parsed, "email")].filter((value): value is string => value !== null),
            phones: [firstPropertyOfType(parsed, "phone_number")].filter((value): value is string => value !== null),
            interests: []
          })
        }
        : {})
    }
  };

  return normalizedImportItemSchema.parse({
    sourceExternalId: parsed.id,
    sourceModifiedAt: normalizeTimestamp(parsed.last_edited_time ?? null),
    contentHash: hashImportContent({ title, body, properties, type }),
    snapshot
  });
}

function normalizeTimestamp(value: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new ImportValidationError("Notion returned an unparseable last_edited_time");
  return date.toISOString();
}

export type NotionTransport = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string }
) => Promise<{ ok: boolean; status: number; text: () => Promise<string> }>;

/** How many block pages are read per Notion page before the body is truncated. */
const MAX_BLOCK_PAGES = 4;

/**
 * Read-only Notion provider.
 *
 * Import is one-directional; nothing is written back. Only top-level textual blocks are read, so
 * nested block trees, tables, and embeds are not represented in the body.
 */
export function createNotionProvider(config: {
  apiToken: string;
  pageSize?: number;
  transport?: NotionTransport;
}): ImportProvider {
  if (!config.apiToken.trim()) throw new ImportValidationError("A Notion API token is required");
  const pageSize = Math.min(Math.max(config.pageSize ?? 50, 1), 100);
  const transport: NotionTransport = config.transport ?? ((url, init) => fetch(url, init));
  const headers = {
    authorization: `Bearer ${config.apiToken}`,
    "notion-version": notionApiVersion,
    "content-type": "application/json"
  };

  async function request(url: string, init: { method: string; body?: string }) {
    const response = await transport(url, { ...init, headers });
    const body = await response.text();
    if (!response.ok) throw new ImportProviderError(`Notion request failed with status ${response.status}`);
    return body;
  }

  async function readBody(pageId: string) {
    const parts: string[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < MAX_BLOCK_PAGES; page += 1) {
      const query = cursor ? `?start_cursor=${encodeURIComponent(cursor)}&page_size=100` : "?page_size=100";
      const parsed = blocksSchema.parse(JSON.parse(await request(
        `https://api.notion.com/v1/blocks/${encodeURIComponent(pageId)}/children${query}`,
        { method: "GET" }
      )));
      for (const block of parsed.results) {
        const kind = textualBlockTypes.find((candidate) => candidate === block.type);
        if (!kind) continue;
        const container = block[kind] as { rich_text?: z.infer<typeof richTextSchema> } | null | undefined;
        const text = plainText(container?.rich_text);
        if (text) parts.push(text);
      }
      cursor = parsed.next_cursor ?? null;
      if (!cursor) break;
    }
    return parts.join("\n") || null;
  }

  return {
    provider: "NOTION",

    async discover(): Promise<ImportManifest> {
      return { provider: "NOTION", estimatedItems: null, scopes: ["notion:read"] };
    },

    async fetchBatch(cursor?: string | null): Promise<ImportBatch> {
      const parsed = searchSchema.parse(JSON.parse(await request("https://api.notion.com/v1/search", {
        method: "POST",
        body: JSON.stringify({
          filter: { property: "object", value: "page" },
          page_size: pageSize,
          ...(cursor ? { start_cursor: cursor } : {})
        })
      })));

      const items: NormalizedImportItem[] = [];
      for (const page of parsed.results) {
        if (page.archived || page.in_trash) continue;
        try {
          items.push(normalizeNotionPage(page, { body: await readBody(page.id) }));
        } catch (error) {
          // A page that cannot be identified is skipped rather than failing the whole batch.
          if (!(error instanceof ImportValidationError)) throw error;
        }
      }

      return { items, nextCursor: parsed.has_more ? parsed.next_cursor ?? null : null };
    }
  };
}
