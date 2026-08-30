import Link from "next/link";
import { redirect } from "next/navigation";
import { provisionActor } from "@/lib/actor";
import { getAuthService } from "@/lib/auth";
import { getObjectRepository } from "@/lib/db";
import { signOut } from "../auth/actions";
import { createNote } from "./actions";

export default async function LibraryPage() {
  const auth = await getAuthService();
  const user = await auth.currentUser();
  if (!user) redirect("/auth");
  const actor = await provisionActor(user);
  const items = await getObjectRepository().list(actor.id);

  return (
    <main className="libraryShell">
      <p className="eyebrow">Authenticated foundation</p>
      <h1>Your private library</h1>
      <p className="muted">Signed in as {user.email ?? "an authenticated user"}.</p>
      <Link className="button askLink" href="/ask">✦ Ask My Life</Link>
      <section className="libraryGrid">
        <form action={createNote} className="noteForm">
          <p className="eyebrow">Create object</p>
          <h2>Capture a note</h2>
          <label className="field">
            <span>Title</span>
            <input name="title" required maxLength={300} />
          </label>
          <label className="field">
            <span>Content</span>
            <textarea name="content" rows={7} maxLength={100000} />
          </label>
          <button className="button" type="submit">Create private note</button>
        </form>
        <section aria-labelledby="objects-title">
          <p className="eyebrow">Private objects</p>
          <h2 id="objects-title">Your library</h2>
          {items.length === 0 ? <p className="muted">No objects yet.</p> : (
            <ol className="objectList">
              {items.map(({ object, currentRevision }) => (
                <li key={object.id}>
                  <Link href={`/library/${object.id}`}>
                    <span>{object.title ?? "Untitled"}</span>
                    <small>{object.type} · revision {currentRevision.id.slice(0, 8)}</small>
                  </Link>
                </li>
              ))}
            </ol>
          )}
        </section>
      </section>
      <form action={signOut}>
        <button className="button buttonSecondary" type="submit">Sign out</button>
      </form>
    </main>
  );
}
