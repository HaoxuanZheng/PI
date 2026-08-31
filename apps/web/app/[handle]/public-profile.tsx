import Link from "next/link";
import type { PublicProfileProjection } from "@lifegraph/publications";

type Props = {
  profile: PublicProfileProjection;
  pages: Array<{ slug: string; title: string | null }>;
  variant: "PROFILE" | "PROFESSIONAL";
};

/** Renders a published projection. It has no access to anything private by construction. */
export function PublicProfile({ profile, pages, variant }: Props) {
  return (
    <main>
      <header>
        <h1>{profile.displayName}</h1>
        <p>@{profile.username}</p>
        {profile.headline ? <p>{profile.headline}</p> : null}
        <nav>
          <Link href={`/@${profile.username}`}>Overview</Link>
          {" · "}
          <Link href={`/@${profile.username}/professional`}>Professional</Link>
        </nav>
      </header>

      {profile.sections.map((section) => (
        <section key={`${section.type}-${section.heading}`}>
          <h2>{section.heading}</h2>
          <ul>
            {section.items.map((item, index) => (
              <li key={`${section.heading}-${index}`}>
                {item.title ? <h3>{item.title}</h3> : null}
                {item.summary ? <p>{item.summary}</p> : null}
                {item.body ? <p>{item.body}</p> : null}
                {item.tags.length ? <p>{item.tags.join(", ")}</p> : null}
              </li>
            ))}
          </ul>
        </section>
      ))}

      {variant === "PROFILE" && pages.length ? (
        <section>
          <h2>Pages</h2>
          <ul>
            {pages.map((page) => (
              <li key={page.slug}>
                <Link href={`/@${profile.username}/p/${page.slug}`}>{page.title ?? page.slug}</Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </main>
  );
}
