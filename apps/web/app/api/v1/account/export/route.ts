import { renderMarkdownExport, requestExportInputSchema } from "@lifegraph/privacy";
import { NextResponse, type NextRequest } from "next/server";
import { handleApiError, parseJson, requestId, requireApiContext } from "@/lib/api";
import { getExportRepository } from "@/lib/db";

/**
 * Exports the full user-owned bundle.
 *
 * Rate-limited to 3/hour by the EXPORT bucket because it assembles a large
 * slice of the database. JSON is authoritative with full revision history;
 * MARKDOWN is a human-readable companion, not a lossless format.
 */
export async function POST(request: NextRequest) {
  const id = requestId(request);
  try {
    const ctx = await requireApiContext(request);
    if (ctx instanceof Response) return ctx;
    const input = await parseJson(request, requestExportInputSchema);
    const bundle = await getExportRepository().exportBundle(ctx.actor.id, ctx.requestId);
    if (input.format === "MARKDOWN") {
      return new NextResponse(renderMarkdownExport(bundle), {
        status: 200,
        headers: { "content-type": "text/markdown; charset=utf-8", "x-request-id": ctx.requestId }
      });
    }
    return NextResponse.json(
      { data: bundle },
      { status: 200, headers: { "x-request-id": ctx.requestId } }
    );
  } catch (error) {
    return handleApiError(error, id);
  }
}
