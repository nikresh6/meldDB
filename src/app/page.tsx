import Link from "next/link";
import {
  ArrowRight,
  Braces,
  Check,
  ChevronRight,
  Code2,
  Database,
  Fingerprint,
  KeyRound,
  LockKeyhole,
  Network,
  ShieldCheck,
  Table2,
} from "lucide-react";
import { ArchitectureVisual } from "@/components/marketing/architecture-visual";
import { ProductPreview } from "@/components/marketing/product-preview";
import { Logo } from "@/components/logo";

export default function HomePage() {
  return (
    <main className="marketing-shell">
      <nav className="marketing-nav" aria-label="Primary navigation">
        <Logo />
        <div className="nav-links"><a href="#product">Product</a><Link href="/docs">Docs</Link><Link href="/security">Security</Link><a href="https://github.com/nikresh6/meldDB"><Code2 size={15} /> GitHub</a></div>
        <div className="nav-actions"><Link href="/login">Sign in</Link><Link className="button primary compact" href="/signup">Start building <ArrowRight size={14} /></Link></div>
      </nav>

      <section className="hero section-grid">
        <div className="hero-copy">
          <div className="eyebrow"><span /> Bring your own database cloud</div>
          <h1>Your databases.<br /><span>One backend.</span></h1>
          <p>Connect cloud databases you already own. MeldDB gives you one logical schema, one API, and one calm developer experience.</p>
          <div className="hero-actions"><Link className="button primary" href="/signup">Start building <ArrowRight size={16} /></Link><a className="button secondary" href="#architecture">See how it works</a></div>
          <div className="hero-proof"><span><Check size={13} /> Customer-owned infrastructure</span><span><Check size={13} /> Scoped provider access</span><span><Check size={13} /> No data lock-in</span></div>
        </div>
        <ArchitectureVisual />
      </section>

      <section className="trust-line" aria-label="Supported providers">
        <span>Connect the infrastructure you already run</span>
        <div><b>Supabase</b><b>Neon</b><b>Cloudflare D1</b></div>
      </section>

      <section className="marketing-section preview-section" id="product">
        <div className="section-heading narrow"><div className="eyebrow">One workspace</div><h2>The database interface your infrastructure was missing.</h2><p>Logical by default. Physical whenever you need the truth.</p></div>
        <ProductPreview />
      </section>

      <section className="marketing-section capacity-story">
        <div className="section-heading"><div className="eyebrow">Capacity, made legible</div><h2>Pool the experience.<br />Respect every limit.</h2><p>MeldDB shows provider quotas as they are. It never invents interchangeable storage or hides compute, request, and egress constraints.</p></div>
        <div className="capacity-diagram">
          <div className="capacity-sources">
            {[["Supabase", "500 MB", "Postgres"], ["Neon", "500 MB", "Postgres"], ["D1", "500 MB", "SQLite"]].map(([name, size, kind], index) => (
              <div className="capacity-row" key={name}><span className={`provider-glyph g${index}`}><Database size={15} /></span><strong>{name}</strong><small>{kind}</small><code>{size}</code></div>
            ))}
          </div>
          <div className="capacity-arrow"><ChevronRight /><span>logical routing</span></div>
          <div className="capacity-total"><small>KNOWN LOGICAL CAPACITY</small><strong>1.5 <span>GB</span></strong><div><i style={{ width: "33%" }} /><i style={{ width: "33%" }} /><i style={{ width: "34%" }} /></div><p>Illustrative browser demo. Actual provider limits and available capacity vary.</p></div>
        </div>
      </section>

      <section className="marketing-section architecture-section" id="architecture">
        <div className="section-heading centered"><div className="eyebrow">Architecture</div><h2>One route in. The right database out.</h2><p>Your application speaks to MeldDB. The logical catalog and explicit shard map do the rest.</p></div>
        <div className="architecture-flow">
          <div><Code2 /><strong>Your app</strong><small>SDK · REST</small></div><span>→</span><div className="accent-box"><Braces /><strong>MeldDB API</strong><small>auth · catalog</small></div><span>→</span><div><Network /><strong>Router</strong><small>stable hash</small></div><span>→</span><div className="provider-destination"><b>Supabase</b><b>Neon</b><b>D1</b></div>
        </div>
        <div className="principle-grid">
          <article><Table2 /><h3>Logical schema</h3><p>Canonical tables and columns live independently from physical placement.</p></article>
          <article><Fingerprint /><h3>Deterministic routing</h3><p>A documented cross-runtime hash maps stable keys to explicit shards.</p></article>
          <article><Code2 /><h3>Honest SQL</h3><p>A safe unified subset, plus full physical SQL when you choose a node.</p></article>
        </div>
      </section>

      <section className="marketing-section ownership-section">
        <div className="ownership-mark"><ShieldCheck /></div>
        <div><div className="eyebrow">Ownership without fine print</div><h2>Your infrastructure stays yours.</h2><p>MeldDB connects to provider accounts you control. Your databases remain there if you disconnect us. Deleting a MeldDB project does not silently delete provider resources.</p><Link href="/security">Read the security model <ArrowRight size={14} /></Link></div>
        <ul><li><LockKeyhole /> AES-256-GCM credential encryption</li><li><KeyRound /> API keys stored as one-way verifiers</li><li><ShieldCheck /> Deliberate destructive confirmations</li></ul>
      </section>

      <section className="marketing-section context-section">
        <div className="context-card"><header><span>developer-context.txt</span><button>Copy context</button></header><pre>{`Project: Northstar\nTables:\n  users(id uuid, email text, status text)\n  orders(id uuid, user_id uuid, total numeric)\n\nAuth: Supabase Auth enabled\nFunctions: 3 deployed on Supabase\nNodes: Neon · Supabase · Cloudflare D1\n\nLimitations:\n  Cross-provider JOIN is not supported.`}</pre></div>
        <div className="section-heading"><div className="eyebrow">Developer context</div><h2>Your tools understand the whole backend.</h2><p>Give Codex, Claude Code, Cursor, or a teammate one clean view of schema, placement, capabilities, and real limitations—without credentials.</p><div className="context-points"><span><Check /> Schema and relationships</span><span><Check /> Physical placement</span><span><Check /> API examples and limitations</span></div></div>
      </section>

      <section className="final-cta"><div><span className="mark-large"><Network /></span><h2>Build against one backend.</h2><p>Keep owning every database underneath it.</p></div><Link className="button primary" href="/signup">Start building <ArrowRight size={16} /></Link></section>

      <footer className="marketing-footer"><Logo /><p>One database experience across your cloud.</p><div><Link href="/docs">Docs</Link><Link href="/security">Security</Link><a href="https://github.com/nikresh6/meldDB">GitHub</a></div><span>© 2026 MeldDB</span></footer>
    </main>
  );
}
