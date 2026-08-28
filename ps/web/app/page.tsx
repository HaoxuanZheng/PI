import Link from "next/link";

const principles = [
  ["Private by default", "Nothing becomes public because an importer or AI guessed that it should."],
  ["One source of truth", "Notes, projects, and identity views will derive from one durable Personal Graph."],
  ["AI proposes", "Every authoritative AI-assisted change will wait for an explicit review and acceptance."],
  ["Built for memory", "Future retrieval will be permission-aware, evidence-backed, and deletion-safe."]
] as const;

export default function HomePage() {
  return (
    <main>
      <nav className="nav" aria-label="Primary navigation">
        <Link className="brand" href="/">LifeGraph</Link>
        <Link className="button buttonSecondary" href="/auth">Sign in</Link>
      </nav>

      <section className="hero">
        <p className="eyebrow">Foundation milestone · v0.1</p>
        <h1>Your life is connected.<br />Your tools should be too.</h1>
        <p className="lede">
          LifeGraph is a private Personal Internet: one place to capture what matters,
          connect it over time, and deliberately shape what the world can see.
        </p>
        <div className="actions">
          <Link className="button" href="/auth?mode=signup">Create your space</Link>
          <a className="textLink" href="#principles">See the principles <span aria-hidden="true">↓</span></a>
        </div>
      </section>

      <section className="principles" id="principles" aria-labelledby="principles-title">
        <div>
          <p className="eyebrow">The contract</p>
          <h2 id="principles-title">A system that earns context.</h2>
        </div>
        <div className="grid">
          {principles.map(([title, description], index) => (
            <article className="card" key={title}>
              <span className="number">0{index + 1}</span>
              <h3>{title}</h3>
              <p>{description}</p>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
