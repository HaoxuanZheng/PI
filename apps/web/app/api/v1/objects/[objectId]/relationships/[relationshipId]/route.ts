import type { NextRequest } from "next/server";
import { z } from "zod";
import { handleApiError, requestId, requireApiContext } from "@/lib/api";
import { getRelationshipRepository } from "@/lib/db";
type Context={params:Promise<{objectId:string;relationshipId:string}>};
export async function DELETE(request:NextRequest,{params}:Context){const id=requestId(request);try{const ctx=await requireApiContext(request);if(ctx instanceof Response)return ctx;const p=await params;await getRelationshipRepository().remove(ctx.actor.id,z.uuid().parse(p.objectId),z.uuid().parse(p.relationshipId),ctx.requestId);return new Response(null,{status:204,headers:{"x-request-id":ctx.requestId}});}catch(error){return handleApiError(error,id);}}
