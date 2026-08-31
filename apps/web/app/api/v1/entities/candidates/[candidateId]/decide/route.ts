import { mergeDecisionSchema } from "@lifegraph/entities";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { apiData, handleApiError, parseJson, requestId, requireApiContext } from "@/lib/api";
import { getEntityRepository } from "@/lib/db";

type Context = { params: Promise<{ candidateId: string }> };

const schema = z.object({
  decision: mergeDecisionSchema,
  // Required for MERGE: the caller chooses which of the two people survives.
  targetObjectId: z.uuid().nullable().default(null)
}).superRefine((value, context) => {
  if (value.decision === "MERGE" && !value.targetObjectId) {
    context.addIssue({ code: "custom", path: ["targetObjectId"], message: "A merge requires targetObjectId" });
  }
});

/** Applies a reviewed decision. A merge is never automatic; the user always chooses. */
export async function POST(request: NextRequest, { params }: Context) {
  const id = requestId(request);
  try {
    const ctx = await requireApiContext(request);
    if (ctx instanceof Response) return ctx;
    const candidateId = z.uuid().parse((await params).candidateId);
    const input = await parseJson(request, schema);
    return apiData(
      await getEntityRepository().decide(ctx.actor.id, candidateId, input.decision, input.targetObjectId, ctx.requestId),
      ctx.requestId
    );
  } catch (error) {
    return handleApiError(error, id);
  }
}
