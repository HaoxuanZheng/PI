import { parseProfileHandle, type PublicProfileProjection } from "@lifegraph/publications";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getPublicReadRepository } from "@/lib/db";
import { PublicProfile } from "./public-profile";

type Props = { params: Promise<{ handle: string }> };

/**
 * Anonymous profile page at `/@username`.
 *
 * Reads only from the publications projection. No canonical object is queried, and no session is
 * required or consulted.
 */
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const username = parseProfileHandle(decodeURIComponent((await params).handle));
  if (!username) return { title: "Not found" };
  const published = await getPublicReadRepository().profile(username, "PROFILE");
  if (!published || published.publicSnapshot.kind === "OBJECT") return { title: "Not found" };
  const profile = published.publicSnapshot.profile;
  return {
    title: `${profile.displayName} (@${profile.username})`,
    ...(profile.headline ? { description: profile.headline } : {})
  };
}

export default async function ProfilePage({ params }: Props) {
  const username = parseProfileHandle(decodeURIComponent((await params).handle));
  if (!username) notFound();

  const repository = getPublicReadRepository();
  const published = await repository.profile(username, "PROFILE");
  if (!published || published.publicSnapshot.kind === "OBJECT") notFound();

  const pages = await repository.objectsFor(username);
  return (
    <PublicProfile
      profile={published.publicSnapshot.profile as PublicProfileProjection}
      pages={pages.map((page) => ({
        slug: page.slug,
        title: page.publicSnapshot.kind === "OBJECT" ? page.publicSnapshot.object.title : null
      }))}
      variant="PROFILE"
    />
  );
}
