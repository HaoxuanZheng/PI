import { aiPatchProposalSchema, applySafePatch, contextManifestSchema, validateProposalContext } from "@lifegraph/ai";
import { z } from "zod";
import { and, desc, eq, sql } from "drizzle-orm";
import type { DatabaseClient } from "../index";
import { aiOperations, auditLogs, objectRevisions, objects as objectTable } from "../schema";
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
export class AIOperationDecisionError extends Error { readonly code = "AI_OPERATION_DECIDED"; }

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
    async list(actorUserId:string,limit=50){return client.db.transaction(async(tx)=>{await tx.execute(sql`select set_config('app.current_user_id', ${actorUserId}, true)`);return tx.select().from(aiOperations).where(eq(aiOperations.userId,actorUserId)).orderBy(desc(aiOperations.createdAt)).limit(Math.min(Math.max(limit,1),100));});},
    async reject(actorUserId:string,operationId:string,requestId?:string){
      return client.db.transaction(async(tx)=>{
        await tx.execute(sql`select set_config('app.current_user_id', ${actorUserId}, true)`);
        const [operation]=await tx.select().from(aiOperations).where(and(eq(aiOperations.id,operationId),eq(aiOperations.userId,actorUserId))).for("update").limit(1);
        if(!operation)throw new AIOperationNotFoundError();
        if(operation.userDecision!=="PENDING")throw new AIOperationDecisionError();
        const [updated]=await tx.update(aiOperations).set({userDecision:"REJECTED",completedAt:new Date()}).where(eq(aiOperations.id,operationId)).returning();
        await tx.insert(auditLogs).values({actorUserId,actorType:"USER",action:"AI_PROPOSAL_REJECTED",resourceType:"OBJECT",resourceId:operation.targetObjectId,requestId,metadata:{operationId}});
        return updated;
      });
    },
    async accept(actorUserId:string,operationId:string,requestId?:string){
      const visible=await client.db.transaction(async(tx)=>{await tx.execute(sql`select set_config('app.current_user_id', ${actorUserId}, true)`);const [operation]=await tx.select().from(aiOperations).where(and(eq(aiOperations.id,operationId),eq(aiOperations.userId,actorUserId))).limit(1);if(!operation)throw new AIOperationNotFoundError();return operation;});
      await permissions.assert({actorUserId,action:"EDIT",resourceType:"OBJECT",resourceId:visible.targetObjectId});
      return client.db.transaction(async(tx)=>{
        await tx.execute(sql`select set_config('app.current_user_id', ${actorUserId}, true)`);
        const [operation]=await tx.select().from(aiOperations).where(and(eq(aiOperations.id,operationId),eq(aiOperations.userId,actorUserId))).for("update").limit(1);
        if(!operation)throw new AIOperationNotFoundError();
        if(operation.userDecision!=="PENDING")throw new AIOperationDecisionError();
        const [object]=await tx.select().from(objectTable).where(eq(objectTable.id,operation.targetObjectId)).for("update").limit(1);
        if(!object||object.currentRevisionId!==operation.targetRevisionId)throw new RevisionConflictError();
        const [base]=await tx.select().from(objectRevisions).where(and(eq(objectRevisions.id,operation.targetRevisionId),eq(objectRevisions.objectId,operation.targetObjectId))).limit(1);
        if(!base)throw new RevisionConflictError();
        let snapshot;
        try{snapshot=applySafePatch(base.snapshot,aiPatchProposalSchema.parse(operation.structuredOutput));}catch(error){throw new AIOperationValidationError(error instanceof Error?error.message:"Invalid patch");}
        const [revision]=await tx.insert(objectRevisions).values({objectId:object.id,previousRevisionId:base.id,snapshot,changeType:"UPDATE",createdByType:"AI_ACCEPTED",createdByUserId:actorUserId,aiOperationId:operation.id}).returning();
        if(!revision)throw new Error("AI revision insert returned no row");
        await tx.update(objectTable).set({title:snapshot.title??null,summary:snapshot.summary??null,currentRevisionId:revision.id,updatedAt:revision.createdAt}).where(eq(objectTable.id,object.id));
        await tx.update(aiOperations).set({userDecision:"ACCEPTED",acceptedPatch:operation.structuredOutput,completedAt:new Date()}).where(eq(aiOperations.id,operation.id));
        await tx.insert(auditLogs).values({actorUserId,actorType:"USER",action:"AI_PROPOSAL_ACCEPTED",resourceType:"OBJECT",resourceId:object.id,requestId,metadata:{operationId:operation.id,createdRevisionId:revision.id}});
        return{operationId:operation.id,revisionId:revision.id,snapshot};
      });
    }
  };
}
