import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import type { ObjectSnapshot } from "@lifegraph/domain";
import { ObjectNotFoundError } from "@lifegraph/db";
import { provisionActor } from "@/lib/actor";
import { getAuthService } from "@/lib/auth";
import { getObjectRepository, getPermissionRepository, getRelationshipRepository } from "@/lib/db";
import { createRelationship, removeRelationship } from "../actions";
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
    const related = await getRelationshipRepository().related(actor.id, parsedId.data);
    const choices = editDecision.allowed ? (await repository.list(actor.id, 100)).filter(({ object }) => object.id !== current.object.id) : [];

    return (
      <main className="libraryShell">
        <Link className="back" href="/library">← Private library</Link>
        <p className="eyebrow">{current.object.type} · {current.object.visibility}</p>
        <ObjectEditor canEdit={editDecision.allowed} initialRevisionId={current.currentRevision.id} initialSnapshot={current.currentRevision.snapshot as ObjectSnapshot} objectId={current.object.id} />

        <section className="relationships" aria-labelledby="relationships-title">
          <p className="eyebrow">Personal graph</p><h2 id="relationships-title">Related objects</h2>
          {editDecision.allowed && choices.length > 0 && <form action={createRelationship} className="relationshipForm">
            <input name="objectId" type="hidden" value={current.object.id} />
            <select aria-label="Relationship" name="relationshipType" defaultValue="RELATED_TO"><option value="RELATED_TO">related to</option><option value="MENTIONS">mentions</option><option value="PART_OF">part of</option><option value="WORKED_ON">worked on</option><option value="ATTENDED">attended</option><option value="KNOWS">knows</option><option value="USES_SKILL">uses skill</option></select>
            <select aria-label="Target object" name="targetObjectId" required>{choices.map(({ object }) => <option key={object.id} value={object.id}>{object.title ?? "Untitled"} · {object.type}</option>)}</select>
            <input aria-label="Optional relationship label" name="label" maxLength={120} placeholder="Optional label" />
            <button className="button" type="submit">Connect</button>
          </form>}
          {related.length === 0 ? <p className="muted">No visible relationships yet.</p> : <ol className="relationshipList">{related.map(({ edge, direction, related: item }) => <li key={edge.id}>
            <Link href={`/library/${item.object.id}`}><strong>{item.object.title ?? "Untitled"}</strong><small>{direction === "OUTGOING" ? "→" : "←"} {edge.relationshipType.toLowerCase().replaceAll("_", " ")} · {item.object.type}{edge.label ? ` · ${edge.label}` : ""}</small></Link>
            {editDecision.allowed && direction === "OUTGOING" && <form action={removeRelationship}><input name="objectId" type="hidden" value={current.object.id} /><input name="relationshipId" type="hidden" value={edge.id} /><button className="iconButton" aria-label="Remove relationship" type="submit">×</button></form>}
          </li>)}</ol>}
        </section>

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
