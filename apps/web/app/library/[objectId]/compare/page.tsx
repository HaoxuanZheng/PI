import { diffSnapshots, type ObjectSnapshot } from "@lifegraph/domain";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { provisionActor } from "@/lib/actor";
import { getAuthService } from "@/lib/auth";
import { getObjectRepository } from "@/lib/db";

type Props = { params: Promise<{ objectId: string }>; searchParams: Promise<{ from?: string; to?: string }> };

export default async function ComparePage({ params, searchParams }: Props) {
  const user = await (await getAuthService()).currentUser();
  if (!user) redirect("/auth");
  const actor = await provisionActor(user);
  const objectId = z.uuid().safeParse((await params).objectId);
  const query = await searchParams;
  const fromId = z.uuid().safeParse(query.from);
  const toId = z.uuid().safeParse(query.to);
  if (!objectId.success || !fromId.success || !toId.success) notFound();
  const revisions = await getObjectRepository().revisions(actor.id, objectId.data);
  const before = revisions.find((item) => item.id === fromId.data);
  const after = revisions.find((item) => item.id === toId.data);
  if (!before || !after) notFound();
  const diff = diffSnapshots(before.snapshot as ObjectSnapshot, after.snapshot as ObjectSnapshot);
  const fields = [
    ["Title", diff.title], ["Summary", diff.summary], ["Tags", diff.tags]
  ] as const;
  return <main className="libraryShell">
    <Link className="back" href={`/library/${objectId.data}`}>← Back to editor</Link>
    <p className="eyebrow">Revision comparison</p>
    <h1 className="compactTitle">What changed?</h1>
    <p className="muted">{before.id.slice(0, 8)} → {after.id.slice(0, 8)}</p>
    <section className="diffList">
      {fields.map(([label, change]) => change && <article className="diffRow" key={label}><strong>{label}</strong><del>{JSON.stringify(change.before)}</del><ins>{JSON.stringify(change.after)}</ins></article>)}
      {diff.body.map((change, index) => <article className="diffRow" key={`${change.kind}-${index}`}>
        <strong>Block {index + 1} · {change.kind}</strong>
        {change.before && <del>{change.before.type}: {change.before.text}</del>}
        {change.after && <ins>{change.after.type}: {change.after.text}</ins>}
      </article>)}
      {!diff.title && !diff.summary && !diff.tags && diff.body.length === 0 && <p className="emptyState">These snapshots are identical.</p>}
    </section>
  </main>;
}
