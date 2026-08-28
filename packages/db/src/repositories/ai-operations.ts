import { aiPatchProposalSchema, contextManifestSchema, validateProposalContext } from "@lifegraph/ai";
import { z } from "zod";
import { and, desc, eq, sql } from "drizzle-orm";
import type { DatabaseClient } from "../index";
import { aiOperations } from "../schema";
import { createObjectRepository, RevisionConflictError } from "./objects";
import { createPermissionRepository } from "./permissions";

const createAIOperationSchema = z.object({
  operationType: z.literal("INLINE_PATCH"), instruction: z.string().trim().min(1).max(10_000),
  targetObjectId: z.uuid(), targetRevisionId: z.uuid(), permittedContextIds: z.array(z.uuid()).max(500),
  retrievedContextManifest: contextManifestSchema, provider: z.string().trim().min(1).max(100), model: z.string().trim().min(1).max(200),
  promptVersion: z.string().trim().min(1).max(100), structuredOutput: aiPatchProposalSchema
});
export type CreateAIOperationInput = z.infer<typeof createAIOperationSchema>;

export class AIOperationNotFoundError extends Error { readonly code = "NOT_FOUND"; }
export class AIOperationValidationError extends Error { readonly code = "VALIDATION_FAILED"; }

export function createAIOperationRepository(client: DatabaseClient) {
  const permissions=createPermissionRepository(client), objects=createObjectRepository(client);
  return {
    async createPending(actorUserId:string, rawInput:unknown) {
      const input=createAIOperationSchema.parse(rawInput);
      if(input.structuredOutput.target.objectId !== input.targetObjectId || input.structuredOutput.target.baseRevisionId !== input.targetRevisionId) throw new AIOperationValidationError("Proposal identity does not match operation target");
      await permissions.assert({actorUserId,action:"EDIT",resourceType:"OBJECT",resourceId:input.targetObjectId});
      const target=await objects.get(actorUserId,input.targetObjectId);
      if(target.currentRevision.id!==input.targetRevisionId) throw new RevisionConflictError();
      for(const objectId of new Set(input.permittedContextIds)) await permissions.assert({actorUserId,action:"READ",resourceType:"OBJECT",resourceId:objectId});
      try { validateProposalContext(input.structuredOutput,input.permittedContextIds,input.retrievedContextManifest); } catch (error) { throw new AIOperationValidationError(error instanceof Error ? error.message : "Invalid AI context manifest"); }
      for(const item of input.retrievedContextManifest.retrieved){const record=await objects.get(actorUserId,item.objectId);if(record.currentRevision.id!==item.revisionId) throw new RevisionConflictError();}
      return client.db.transaction(async(tx)=>{await tx.execute(sql`select set_config('app.current_user_id', ${actorUserId}, true)`);const [created]=await tx.insert(aiOperations).values({id:input.structuredOutput.operationId,userId:actorUserId,operationType:input.operationType,instruction:input.instruction,targetObjectId:input.targetObjectId,targetRevisionId:input.targetRevisionId,permittedContextIds:[...new Set(input.permittedContextIds)],retrievedContextManifest:input.retrievedContextManifest,provider:input.provider,model:input.model,promptVersion:input.promptVersion,structuredOutput:input.structuredOutput,validationStatus:"VALID",userDecision:"PENDING"}).returning();if(!created)throw new Error("AI operation insert returned no row");return created;});
    },
    async get(actorUserId:string,operationId:string){return client.db.transaction(async(tx)=>{await tx.execute(sql`select set_config('app.current_user_id', ${actorUserId}, true)`);const [operation]=await tx.select().from(aiOperations).where(and(eq(aiOperations.id,operationId),eq(aiOperations.userId,actorUserId))).limit(1);if(!operation)throw new AIOperationNotFoundError();return operation;});},
    async list(actorUserId:string,limit=50){return client.db.transaction(async(tx)=>{await tx.execute(sql`select set_config('app.current_user_id', ${actorUserId}, true)`);return tx.select().from(aiOperations).where(eq(aiOperations.userId,actorUserId)).orderBy(desc(aiOperations.createdAt)).limit(Math.min(Math.max(limit,1),100));});}
  };
}
