import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { ObjectNotFoundError } from "@lifegraph/db";
import { provisionActor } from "@/lib/actor";
import { getAuthService } from "@/lib/auth";
import { getObjectRepository } from "@/lib/db";
import { restoreRevision } from "../actions";

type ObjectPageProps = { params: Promise<{ objectId: string }> };

export default async function ObjectPage({ params }: ObjectPageProps) {
  const user = await (await getAuthService()).currentUser();
  if (!user) redirect("/auth");
  const actor = await provisionActor(user);
  const parsedId = z.uuid().safeParse((await params).objectId);
  if (!parsedId.success) notFound();

  try {
    const repository = getObjectRepository();
    const current = await repository.get(actor.id, parsedId.data);
    const revisions = await repository.revisions(actor.id, parsedId.data);
    const content = current.currentRevision.snapshot.body?.content;

    return (
      <main className="libraryShell">
        <Link className="back" href="/library">← Private library</Link>
        <p className="eyebrow">{current.object.type} · {current.object.visibility}</p>
        <h1>{current.object.title ?? "Untitled"}</h1>
        {typeof content === "string" ? <div className="objectBody">{content}</div> : (
          <pre className="snapshot">{JSON.stringify(current.currentRevision.snapshot, null, 2)}</pre>
        )}

        <section className="history" aria-labelledby="history-title">
          <p className="eyebrow">Immutable history</p>
          <h2 id="history-title">Revisions</h2>
          <ol className="revisionList">
            {revisions.map((revision) => {
              const isCurrent = revision.id === current.object.currentRevisionId;
              return (
                <li key={revision.id}>
                  <div>
                    <strong>{revision.changeType}</strong>
                    <small>{revision.createdAt.toISOString()} · {revision.id.slice(0, 8)}</small>
                    <details>
                      <summary>View snapshot</summary>
                      <pre className="snapshot compactSnapshot">{JSON.stringify(revision.snapshot, null, 2)}</pre>
                    </details>
                  </div>
                  {isCurrent ? <span className="currentBadge">Current</span> : (
                    <form action={restoreRevision}>
                      <input name="objectId" type="hidden" value={current.object.id} />
                      <input name="revisionId" type="hidden" value={revision.id} />
                      <input name="expectedRevisionId" type="hidden" value={current.object.currentRevisionId ?? ""} />
                      <button className="button buttonSecondary" type="submit">Restore</button>
                    </form>
                  )}
                </li>
              );
            })}
          </ol>
        </section>
      </main>
    );
  } catch (error) {
    if (error instanceof ObjectNotFoundError) notFound();
    throw error;
  }
}
