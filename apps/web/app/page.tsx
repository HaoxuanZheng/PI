import Link from "next/link";

const principles = [
  ["Private by default", "Every note, import, and connection starts private. You decide what leaves your graph."],
  ["One durable graph", "Projects, people, decisions, and memories stay connected instead of disappearing across tools."],
  ["AI proposes", "PI can draft and connect. You accept, edit, or reject every authoritative change."],
  ["Evidence included", "Answers point back to the notes and revisions that support them, so context stays inspectable."]
] as const;

const workflow = [
  ["01", "Capture", "Save a note, decision, person, or project in seconds."],
  ["02", "Connect", "Build relationships across the things that matter to you."],
  ["03", "Ask", "Get grounded answers from only the information you can access."],
  ["04", "Publish", "Share a deliberate projection—not your private source graph."]
] as const;

export default function HomePage() {
  return (
    <main className="homePage">
      <nav className="nav homeNav" aria-label="Primary navigation">
        <Link className="brand brandLockup" href="/" aria-label="PI home"><span className="brandMark">P</span><span>PI</span></Link>
        <div className="navLinks" aria-label="Page sections"><a href="#product">Product</a><a href="#demo">Demo</a><a href="#principles">Principles</a></div>
        <div className="navActions"><Link className="navSignIn" href="/auth">Sign in</Link><Link className="button homeButton" href="/auth?mode=signup">Start your PI</Link></div>
      </nav>

      <section className="homeHero" id="product">
        <div className="heroCopy">
          <p className="homeKicker"><span /> Your private intelligence layer</p>
          <h1>Remember everything.<br /><em>Own the context.</em></h1>
          <p className="homeLede">PI turns scattered notes, people, projects, and decisions into one private Personal Graph—then helps you think with it without taking control away from you.</p>
          <div className="actions">
            <Link className="button homeButton homeButtonLarge" href="/auth?mode=signup">Create your private space <span aria-hidden="true">↗</span></Link>
            <a className="demoLink" href="#demo"><span className="playIcon">▶</span> Explore the demo</a>
          </div>
          <div className="trustRow" aria-label="Product promises"><span>Private by default</span><span>Human-approved AI</span><span>Export anytime</span></div>
        </div>

        <div className="heroVisual" aria-label="PI product preview">
          <div className="visualGlow" />
          <div className="appFrame">
            <div className="appTopbar"><div className="windowDots"><i /><i /><i /></div><span className="appTitle">PI / Private space</span><span className="encryptedBadge">● Encrypted</span></div>
            <div className="appBody">
              <aside className="demoSidebar"><div className="miniBrand">P</div><span className="sideActive">⌂</span><span>⌕</span><span>◇</span><span>◎</span><span className="sideBottom">⚙</span></aside>
              <div className="demoWorkspace">
                <div className="workspaceHeader"><div><small>GOOD MORNING</small><h2>Your world, in context.</h2></div><button aria-label="Add new object">＋</button></div>
                <div className="demoStats"><div><strong>128</strong><span>private objects</span></div><div><strong>36</strong><span>connections</span></div><div><strong>12</strong><span>revisions this week</span></div></div>
                <div className="demoColumns">
                  <section className="recentPanel"><div className="panelHeading"><span>Recent memory</span><small>View all</small></div><article><i className="noteIcon">N</i><div><strong>Product direction</strong><small>Decision · 2 hours ago</small></div><b>•••</b></article><article><i className="personIcon">H</i><div><strong>Hana Kim</strong><small>Person · Connected to 4 projects</small></div><b>•••</b></article><article><i className="projectIcon">P</i><div><strong>Autumn launch</strong><small>Project · Updated yesterday</small></div><b>•••</b></article></section>
                  <section className="askPreview"><div className="askOrb">✦</div><small>ASK PI</small><p>“What did I decide about the launch timeline?”</p><div className="answerPreview"><span /> You moved the launch to October after the research review…</div><div className="evidencePreview">3 evidence references <span>→</span></div></section>
                </div>
              </div>
            </div>
          </div>
          <div className="floatingCard floatingPrivate"><span>✓</span><div><strong>Private by default</strong><small>Only you can access this</small></div></div>
          <div className="floatingCard floatingProposal"><span>✦</span><div><strong>Proposal ready</strong><small>Review before applying</small></div></div>
        </div>
      </section>

      <section className="homeProof" aria-label="PI capabilities"><p>One place for the context behind your work and life</p><div><span>NOTES</span><span>PEOPLE</span><span>PROJECTS</span><span>DECISIONS</span><span>MEMORY</span></div></section>

      <section className="demoSection" id="demo" aria-labelledby="demo-title">
        <div className="sectionIntro"><p className="homeKicker"><span /> A calmer way to know what you know</p><h2 id="demo-title">From capture to clarity.</h2><p>PI preserves the trail between a thought and a decision, so your intelligence compounds instead of resetting every day.</p></div>
        <div className="workflowGrid">{workflow.map(([number, title, description]) => <article key={title}><span>{number}</span><div className={`workflowGlyph glyph${number}`}>{number === "01" ? "＋" : number === "02" ? "⌘" : number === "03" ? "✦" : "↗"}</div><h3>{title}</h3><p>{description}</p></article>)}</div>
      </section>

      <section className="intelligenceDemo" aria-labelledby="intelligence-title">
        <div className="intelligenceCopy"><p className="homeKicker lightKicker"><span /> Intelligence with an audit trail</p><h2 id="intelligence-title">AI that works for your memory—not instead of it.</h2><p>Every answer is permission-aware. Every proposed change waits for you. Every accepted edit becomes a new revision you can inspect or restore.</p><ul><li><span>✓</span> Evidence-backed answers</li><li><span>✓</span> Accept, edit, or reject proposals</li><li><span>✓</span> Immutable revision history</li></ul><Link className="button limeButton" href="/auth?mode=signup">Try PI privately</Link></div>
        <div className="proposalDemo"><div className="proposalTop"><span>✦ PI proposal</span><small>Waiting for your review</small></div><p className="proposalPrompt">Summarize the launch decision and connect it to the Autumn launch project.</p><div className="changeCard"><small>PROPOSED CHANGE</small><strong>Launch moved to October</strong><p>Research review showed onboarding needed one more iteration before the public release.</p></div><div className="proposalEvidence"><span>Evidence</span><span>Research review</span><span>Planning note</span></div><div className="proposalActions"><button>Reject</button><button>Edit</button><button className="acceptButton">Accept proposal</button></div></div>
      </section>

      <section className="principles homePrinciples" id="principles" aria-labelledby="principles-title">
        <div className="sectionIntro"><p className="homeKicker"><span /> The trust contract</p><h2 id="principles-title">Personal intelligence needs personal boundaries.</h2><p>PI is designed around ownership, explicit consent, and a durable record—not engagement or extraction.</p></div>
        <div className="principleGrid">{principles.map(([title, description], index) => <article className="principleCard" key={title}><span className="principleNumber">0{index + 1}</span><h3>{title}</h3><p>{description}</p></article>)}</div>
      </section>

      <section className="finalCta"><div><p className="homeKicker lightKicker"><span /> Your context belongs to you</p><h2>Build a memory<br />that grows with you.</h2></div><div><p>Start with one note. Connect what matters. Let PI help you see the whole picture.</p><Link className="button limeButton homeButtonLarge" href="/auth?mode=signup">Create your private space <span aria-hidden="true">↗</span></Link></div></section>

      <footer className="homeFooter"><Link className="brand brandLockup" href="/"><span className="brandMark">P</span><span>PI</span></Link><p>Your private, durable personal intelligence.</p><div><a href="#product">Product</a><a href="#principles">Privacy</a><Link href="/auth">Sign in</Link></div><small>© 2026 PI. Your context stays yours.</small></footer>
    </main>
  );
}
