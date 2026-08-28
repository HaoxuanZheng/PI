import type { NextRequest } from "next/server";
import { z } from "zod";
import { apiData, handleApiError, requestId, requireApiContext } from "@/lib/api";
import { getAIOperationRepository } from "@/lib/db";
type Context={params:Promise<{operationId:string}>};
export async function GET(request:NextRequest,{params}:Context){const id=requestId(request);try{const ctx=await requireApiContext(request);if(ctx instanceof Response)return ctx;return apiData(await getAIOperationRepository().get(ctx.actor.id,z.uuid().parse((await params).operationId)),ctx.requestId);}catch(error){return handleApiError(error,id);}}
