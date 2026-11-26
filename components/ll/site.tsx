import Link from "next/link";

export const Brand = ({ href = "/" }: { href?: string }) => (
  <Link href={href} className="ll-h2 flex items-center gap-2.5" style={{ fontSize: 22 }}>
    <span aria-hidden="true" className="ll-mark">+</span>
    LifeLine
  </Link>
);

export const UtilityBar = () => (
  <div className="ll-utility">
    <div className="ll-wrap flex flex-wrap justify-between gap-x-6 gap-y-1 py-2">
      <span>World Problem Solver Track · Hack the Vibe 2026</span>
      <span>Demonstration system with fictional data</span>
    </div>
  </div>
);

export function SiteHeader({ links = [] }: { links?: { href: string; label: string }[] }) {
  return (
    <>
      <UtilityBar />
      <header className="ll-topbar">
        <div className="ll-wrap flex flex-wrap items-center justify-between gap-x-6 gap-y-2 py-3.5">
          <Brand />
          <nav className="ll-nav" aria-label="Site">
            {links.map((l) => <Link key={l.href} href={l.href}>{l.label}</Link>)}
            <Link href="/login">Sign in</Link>
          </nav>
        </div>
      </header>
    </>
  );
}

export const SiteFooter = () => (
  <footer className="ll-band-dark mt-auto">
    <div className="ll-wrap flex flex-wrap justify-between gap-4 py-6 text-sm">
      <p className="ll-muted max-w-xl">
        LifeLine is demonstration software, not a medical device. In a real emergency, contact your hospital or emergency services.
      </p>
      <p className="ll-muted">
        <a className="underline" href="https://github.com/tamjidul04/lifeline">Source code</a> · Visual style inspired by the MedCare
        template by Colorlib
      </p>
      <p className="ll-muted w-full text-xs">
        The pictures on the home page are AI-generated illustrations made with Google Gemini. They do not show real people, patients or
        events.
      </p>
    </div>
  </footer>
);
