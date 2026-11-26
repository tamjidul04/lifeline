import Image from "next/image";
import Link from "next/link";
import { BagLabel } from "@/components/ll/ui";
import { SiteFooter, SiteHeader } from "@/components/ll/site";
import { ScrollReveal } from "@/components/ll/reveal";

const PILLARS = [
  { title: "Safe matching", text: "Only compatible, unexpired blood is offered. The soonest-expiring safe bag is preferred, so less is wasted." },
  { title: "No double booking", text: "Bags are held inside a database transaction. When many hospitals want the last one, exactly one gets it." },
  { title: "Every choice explained", text: "Each bag comes with its reason. When a request can't be met, you see why and what you can do next." },
];

const PROBLEMS = [
  { title: "Searching takes time", text: "Hospital staff phone blood banks one by one while a patient waits." },
  { title: "The same bag gets promised twice", text: "Two callers can be told that the last unit is theirs." },
  { title: "Blood expires on the shelf", text: "One bank discards expiring units while a hospital nearby goes without." },
];

const STEPS = [
  ["Bank adds stock", "Each bag is recorded with its blood group, component and expiry date."],
  ["Hospital requests", "Staff choose group, component, quantity and urgency, and preview the result."],
  ["Best bags are held", "The matching rules pick compatible bags and reserve them for that request."],
  ["Bank delivers", "The bank sees which bags are held and marks each one delivered."],
  ["Everything is recorded", "Requests, deliveries and stock changes go into the audit log."],
];

const ROLES = [
  ["Hospital staff", "Request blood, follow progress, and cancel when plans change."],
  ["Blood bank", "Manage stock, see expiring bags and confirm deliveries."],
  ["Donor", "Register and see when you can donate again."],
  ["Administrator", "Create staff accounts, review the audit log and reset demo data."],
];

export default function Home() {
  return (
    <>
      <SiteHeader links={[{ href: "#problem", label: "The problem" }, { href: "#how", label: "How it works" }, { href: "#who", label: "Who uses it" }]} />
      <ScrollReveal />
      <main className="flex-1">
        <section className="bg-[var(--paper)]">
          <div className="ll-wrap grid items-center gap-10 py-14 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,.9fr)] lg:py-20">
            <div className="ll-enter">
              <p lang="bn" className="mb-3 text-lg font-bold text-[var(--brand)]">রক্ত দিন, জীবন বাঁচান</p>
              <h1 className="ll-display-xl">The right blood, to the right hospital, before it expires.</h1>
              <p className="ll-muted mt-5 max-w-xl text-lg">
                LifeLine, built with Bangladesh in mind, helps hospitals find compatible blood across blood banks, holds it so nobody else can take it, and explains every
                decision.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <Link className="ll-btn" href="/login">Sign in</Link>
                <Link className="ll-btn ll-btn-outline" href="/register">Register as a donor</Link>
              </div>
            </div>
            <figure className="ll-enter ll-enter-late">
              <Image
                src="/photos/ai-donation.jpg"
                alt="Illustration: a young man calmly donating blood in a donation chair while a health worker prepares supplies"
                width={1600}
                height={1073}
                priority
                sizes="(min-width: 1024px) 560px, 100vw"
                className="h-auto w-full"
              />
              <figcaption className="ll-muted mt-1.5 text-xs">AI-generated illustration</figcaption>
            </figure>
          </div>
        </section>

        <section className="ll-band" aria-label="What LifeLine does">
          <div className="ll-wrap grid gap-8 py-10 md:grid-cols-3">
            {PILLARS.map((p, i) => (
              <div key={p.title} data-reveal style={{ "--reveal-delay": `${i * 120}ms` } as React.CSSProperties}>
                <h2 className="ll-h2">{p.title}</h2>
                <p className="mt-2 text-[15px]">{p.text}</p>
              </div>
            ))}
          </div>
        </section>

        <section id="problem" className="ll-wrap py-14" aria-labelledby="problem-title">
          <div className="grid items-center gap-8 md:grid-cols-2" data-reveal>
            <figure>
              <Image
                src="/photos/ai-transfusion.jpg"
                alt="Illustration: a nurse checks a blood transfusion for a woman resting in a hospital bed while a relative sits beside her"
                width={1600}
                height={1073}
                sizes="(min-width: 768px) 580px, 100vw"
                className="h-auto w-full"
              />
              <figcaption className="ll-muted mt-1.5 text-xs">AI-generated illustration</figcaption>
            </figure>
            <div>
              <h2 id="problem-title" className="ll-display-l">The problem we are solving</h2>
              <p className="ll-muted mt-3">
                In an emergency, hospitals need compatible blood quickly. It affects patients waiting for a transfusion, the hospital staff
                searching for it, and the blood banks trying not to waste it.
              </p>
            </div>
          </div>
          <div className="mt-8 grid gap-5 md:grid-cols-3">
            {PROBLEMS.map((p, i) => (
              <article key={p.title} className="ll-card" data-reveal style={{ "--reveal-delay": `${i * 120}ms` } as React.CSSProperties}>
                <h3 className="ll-h2">{p.title}</h3>
                <span aria-hidden="true" className="ll-rule-short" />
                <p className="ll-muted">{p.text}</p>
              </article>
            ))}
          </div>
        </section>

        <section id="how" className="bg-[var(--paper)] py-14" aria-labelledby="how-title">
          <div className="ll-wrap">
            <h2 id="how-title" className="ll-display-l" data-reveal>How it works</h2>
            <ol className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-5">
              {STEPS.map(([title, text], i) => (
                <li key={title} className="ll-card !px-5" data-reveal style={{ "--reveal-delay": `${i * 130}ms` } as React.CSSProperties}>
                  <span className="ll-display-l block text-[var(--brand)]" aria-hidden="true">{i + 1}</span>
                  <h3 className="ll-h2 mt-2" style={{ fontSize: 18 }}>{title}</h3>
                  <p className="ll-muted mt-2 text-sm">{text}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="ll-wrap grid items-center gap-10 pt-14 lg:grid-cols-2" aria-labelledby="decision-title">
          <div data-reveal>
            <h2 id="decision-title" className="ll-display-l">What a decision looks like</h2>
            <p className="ll-muted mt-3">
              Every held bag shows its blood group, where it comes from and why it was chosen. A dashed border marks a compatible
              substitute. Substitutes are only used when the urgency allows them.
            </p>
          </div>
          <figure className="ll-sheet !p-6" data-reveal style={{ "--reveal-delay": "150ms" } as React.CSSProperties}>
            <figcaption className="ll-eyebrow mb-3">Example: critical request for AB− red cells</figcaption>
            <div className="grid gap-2.5">
              <BagLabel type="AB_NEG" component="RBC">
                <span>Exact match</span>
                <span className="ll-muted">Same group as the patient</span>
              </BagLabel>
              <BagLabel type="A_NEG" component="RBC" substitute>
                <span>Compatible substitute</span>
                <span className="ll-muted">Allowed because the request is critical</span>
              </BagLabel>
            </div>
            <p className="ll-muted mt-3 text-sm">An Rh-positive bag is never offered to an Rh-negative patient.</p>
          </figure>
        </section>

        <section id="who" className="ll-wrap py-14" aria-labelledby="who-title">
          <h2 id="who-title" className="ll-display-l" data-reveal>Who uses it</h2>
          <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {ROLES.map(([title, text], i) => (
              <article key={title} className="ll-card" data-reveal style={{ "--reveal-delay": `${i * 110}ms` } as React.CSSProperties}>
                <h3 className="ll-h2">{title}</h3>
                <span aria-hidden="true" className="ll-rule-short" />
                <p className="ll-muted text-[15px]">{text}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="ll-band" aria-labelledby="judge-title">
          <div className="ll-wrap flex flex-wrap items-center justify-between gap-5 py-9" data-reveal>
            <div>
              <h2 id="judge-title" className="ll-display-l">Judging this project?</h2>
              <p className="mt-1">Sign in with a test account, then open Judge demo to try both advanced challenges.</p>
            </div>
            <Link className="ll-btn !border-white !bg-white !text-[var(--brand)]" href="/demo">Open the judge demo</Link>
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
