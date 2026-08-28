import type { NextRequest } from "next/server";
import { apiData, handleApiError, requestId, requireApiContext } from "@/lib/api";
import { getAIOperationRepository } from "@/lib/db";
export async function GET(request:NextRequest){const id=requestId(request);try{const ctx=await requireApiContext(request);if(ctx instanceof Response)return ctx;return apiData(await getAIOperationRepository().list(ctx.actor.id),ctx.requestId);}catch(error){return handleApiError(error,id);}}
