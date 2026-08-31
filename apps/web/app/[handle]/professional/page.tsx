import { parseProfileHandle, type PublicProfileProjection } from "@lifegraph/publications";
import { notFound } from "next/navigation";
import { getPublicReadRepository } from "@/lib/db";
import { PublicProfile } from "../public-profile";

type Props = { params: Promise<{ handle: string }> };

/** Anonymous professional view at `/@username/professional`. */
export default async function ProfessionalPage({ params }: Props) {
  const username = parseProfileHandle(decodeURIComponent((await params).handle));
  if (!username) notFound();

  const published = await getPublicReadRepository().profile(username, "PROFESSIONAL");
  if (!published || published.publicSnapshot.kind === "OBJECT") notFound();

  return (
    <PublicProfile
      profile={published.publicSnapshot.profile as PublicProfileProjection}
      pages={[]}
      variant="PROFESSIONAL"
    />
  );
}
