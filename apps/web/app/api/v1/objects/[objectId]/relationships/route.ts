import { createRelationshipInputSchema } from "@lifegraph/domain";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { apiData, handleApiError, parseJson, requestId, requireApiContext } from "@/lib/api";
import { getRelationshipRepository } from "@/lib/db";
type Context = { params: Promise<{ objectId: string }> };
export async function GET(request: NextRequest, { params }: Context) { const id=requestId(request); try { const ctx=await requireApiContext(request); if(ctx instanceof Response)return ctx; const objectId=z.uuid().parse((await params).objectId); return apiData(await getRelationshipRepository().related(ctx.actor.id, objectId),ctx.requestId); } catch(error){ return handleApiError(error,id); } }
export async function POST(request: NextRequest, { params }: Context) { const id=requestId(request); try { const ctx=await requireApiContext(request); if(ctx instanceof Response)return ctx; const objectId=z.uuid().parse((await params).objectId); const input=await parseJson(request,createRelationshipInputSchema); return apiData(await getRelationshipRepository().create(ctx.actor.id,objectId,input,ctx.requestId),ctx.requestId,201); } catch(error){ return handleApiError(error,id); } }
