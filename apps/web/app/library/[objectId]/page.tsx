import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import type { ObjectSnapshot } from "@lifegraph/domain";
import { ObjectNotFoundError } from "@lifegraph/db";
import { provisionActor } from "@/lib/actor";
import { getAuthService } from "@/lib/auth";
import { getObjectRepository, getPermissionRepository } from "@/lib/db";
import { ObjectEditor } from "./ObjectEditor";
import { RestoreRevisionButton } from "./RestoreRevisionButton";

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
    const editDecision = await getPermissionRepository().can({ actorUserId: actor.id, action: "EDIT", resourceType: "OBJECT", resourceId: parsedId.data });

    return (
      <main className="libraryShell">
        <Link className="back" href="/library">← Private library</Link>
        <p className="eyebrow">{current.object.type} · {current.object.visibility}</p>
        <ObjectEditor canEdit={editDecision.allowed} initialRevisionId={current.currentRevision.id} initialSnapshot={current.currentRevision.snapshot as ObjectSnapshot} objectId={current.object.id} />

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
                    {!isCurrent && <Link className="compareLink" href={`/library/${current.object.id}/compare?from=${revision.id}&to=${current.currentRevision.id}`}>Compare to current</Link>}
                  </div>
                  {isCurrent ? <span className="currentBadge">Current</span> : (
                    editDecision.allowed
                      ? <RestoreRevisionButton expectedRevisionId={current.object.currentRevisionId ?? ""} objectId={current.object.id} revisionId={revision.id} />
                      : <span className="muted">Read only</span>
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
