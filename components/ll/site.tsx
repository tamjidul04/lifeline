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
        Photos: U.S. Air Force, Airman 1st Class Kendall Stuckman, public domain, via{" "}
        <a className="underline" href="https://commons.wikimedia.org/wiki/File:Tri-border_blood_donors_save_lives_(7098718).jpg">
          Wikimedia Commons
        </a>
        . Illustrative only. Their use does not imply endorsement by the people shown or the U.S. Department of Defense.
      </p>
    </div>
  </footer>
);
