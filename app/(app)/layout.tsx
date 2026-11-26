import Link from "next/link";
import type { Role } from "@prisma/client";
import { requirePageUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { Nav } from "@/components/ll/nav";
import { LogoutButton } from "@/components/logout-button";

const DEMO = { href: "/demo", label: "Judge demo" };
const LINKS: Record<Role, { href: string; label: string }[]> = {
  HOSPITAL: [{ href: "/dashboard", label: "Overview" }, { href: "/requests", label: "Requests" }, { href: "/requests/new", label: "New request" }, DEMO],
  BANK: [{ href: "/dashboard", label: "Overview" }, { href: "/inventory", label: "Bank stock" }, { href: "/requests", label: "Requests" }, DEMO],
  ADMIN: [{ href: "/dashboard", label: "Overview" }, { href: "/inventory", label: "Stock" }, { href: "/requests", label: "Requests" }, { href: "/admin", label: "Admin" }, DEMO],
  DONOR: [{ href: "/dashboard", label: "My eligibility" }, DEMO],
};

const ROLE_LABEL: Record<Role, string> = { ADMIN: "Administrator", BANK: "Blood bank", HOSPITAL: "Hospital staff", DONOR: "Donor" };

// This layout only draws the shell. Every page checks the session and role itself.
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const actor = await requirePageUser();
  const org = actor.hospitalId
    ? (await prisma.hospital.findUnique({ where: { id: actor.hospitalId }, select: { name: true } }))?.name
    : actor.bankId
      ? (await prisma.bank.findUnique({ where: { id: actor.bankId }, select: { name: true } }))?.name
      : actor.name;

  return (
    <>
      <a href="#content" className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:bg-white focus:p-2">Skip to content</a>
      <header className="ll-topbar">
        <div className="ll-wrap flex flex-wrap items-center gap-x-5 gap-y-1 py-2.5">
          <Link href="/dashboard" className="ll-h2 flex items-center gap-2">
            <span aria-hidden="true" className="inline-block h-4 w-3 rounded-[50%_50%_50%_50%/60%_60%_40%_40%] bg-[var(--crit)]" />
            LifeLine
          </Link>
          <div className="order-3 w-full min-w-0 md:order-none md:w-auto md:flex-1">
            <Nav links={LINKS[actor.role]} />
          </div>
          <div className="ml-auto flex items-center gap-3">
            <div className="hidden text-right text-[13px] leading-tight sm:block">
              <b className="block text-sm">{org}</b>
              <span className="ll-muted">{ROLE_LABEL[actor.role]}</span>
            </div>
            <LogoutButton />
          </div>
        </div>
      </header>
      <main id="content" className="ll-wrap flex-1 py-5 pb-14">{children}</main>
    </>
  );
}
