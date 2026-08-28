import { objectSnapshotSchema, type ObjectSnapshot } from "@lifegraph/domain";
import { z, type ZodType } from "zod";

export type StructuredRequest<T> = { schema: ZodType<T>; system: string; input: string; promptVersion: string };
export type TextRequest = { system: string; input: string; promptVersion: string };
export type TextResult = { text: string; provider: string; model: string };
export type AudioInput = { bytes: Uint8Array; mediaType: string };
export type Transcript = { text: string; language?: string };
export interface AIProvider {
  readonly name: string;
  readonly model: string;
  generateStructured<T>(request: StructuredRequest<T>): Promise<T>;
  generateText(request: TextRequest): Promise<TextResult>;
  embed(inputs: string[]): Promise<number[][]>;
  transcribe?(input: AudioInput): Promise<Transcript>;
}
export async function generateValidatedStructured<T>(provider: AIProvider, request: StructuredRequest<T>): Promise<T> {
  return request.schema.parse(await provider.generateStructured(request));
}

const patchPathSchema = z.enum(["/title", "/summary", "/body", "/tags"]);
export const safePatchOperationSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("replace"), path: patchPathSchema, before: z.unknown(), after: z.unknown() }),
  z.object({ op: z.literal("add"), path: patchPathSchema, after: z.unknown() }),
  z.object({ op: z.literal("remove"), path: patchPathSchema, before: z.unknown() })
]);
export const aiPatchProposalSchema = z.object({
  operationId: z.uuid(),
  target: z.object({ objectId: z.uuid(), baseRevisionId: z.uuid() }),
  summary: z.string().trim().min(1).max(1000),
  operations: z.array(safePatchOperationSchema).min(1).max(50),
  evidence: z.array(z.object({ sourceObjectId: z.uuid(), sourceRevisionId: z.uuid(), reason: z.string().trim().min(1).max(500) })).max(100),
  warnings: z.array(z.string().max(500)).max(50),
  confidence: z.number().min(0).max(1)
});
export const contextManifestSchema = z.object({
  requestedScopes: z.array(z.string().trim().min(1).max(80)).max(50),
  retrieved: z.array(z.object({ objectId: z.uuid(), revisionId: z.uuid(), reason: z.string().max(500), permission: z.string().max(80) })).max(500)
});
export type AIPatchProposal = z.infer<typeof aiPatchProposalSchema>;
export type AIContextManifest = z.infer<typeof contextManifestSchema>;

const equal = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);
export function validateProposalContext(proposal: AIPatchProposal, permittedContextIds: string[], manifest: AIContextManifest) {
  const permitted = new Set(permittedContextIds);
  for (const item of manifest.retrieved) if (!permitted.has(item.objectId)) throw new Error("Retrieved context is not permitted");
  const retrieved = new Set(manifest.retrieved.map((item) => `${item.objectId}:${item.revisionId}`));
  for (const evidence of proposal.evidence) if (!retrieved.has(`${evidence.sourceObjectId}:${evidence.sourceRevisionId}`)) throw new Error("Proposal evidence is absent from the context manifest");
  return proposal;
}

export function applySafePatch(snapshot: ObjectSnapshot, proposal: AIPatchProposal): ObjectSnapshot {
  const next = structuredClone(snapshot) as Record<string, unknown>;
  for (const operation of proposal.operations) {
    const key = operation.path.slice(1);
    if ("before" in operation && !equal(next[key], operation.before)) throw new Error(`Patch precondition failed at ${operation.path}`);
    if (operation.op === "remove") delete next[key]; else next[key] = operation.after;
  }
  return objectSnapshotSchema.parse(next);
}

const prompts = new Map<string, { version: string; system: string }>();
export function registerPrompt(name: string, version: string, system: string) {
  if (prompts.has(`${name}:${version}`)) throw new Error("Prompt version already registered");
  const prompt = { version, system }; prompts.set(`${name}:${version}`, prompt); return prompt;
}
export function getPrompt(name: string, version: string) {
  const prompt = prompts.get(`${name}:${version}`); if (!prompt) throw new Error("Prompt version is not registered"); return prompt;
}
