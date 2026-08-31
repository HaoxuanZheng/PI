import { parseProfileHandle } from "@lifegraph/publications";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getPublicReadRepository } from "@/lib/db";

type Props = { params: Promise<{ handle: string; slug: string }> };

/** Anonymous public object page at `/@username/p/{slug}`. */
export default async function PublicObjectPage({ params }: Props) {
  const resolved = await params;
  const username = parseProfileHandle(decodeURIComponent(resolved.handle));
  if (!username) notFound();

  const published = await getPublicReadRepository().object(username, decodeURIComponent(resolved.slug));
  if (!published || published.publicSnapshot.kind !== "OBJECT") notFound();

  const object = published.publicSnapshot.object;
  return (
    <main>
      <p><Link href={`/@${username}`}>@{username}</Link></p>
      {object.title ? <h1>{object.title}</h1> : null}
      {object.summary ? <p>{object.summary}</p> : null}
      {object.body ? <article>{object.body}</article> : null}
      {object.tags.length ? <p>{object.tags.join(", ")}</p> : null}
    </main>
  );
}
