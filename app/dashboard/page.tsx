import { requirePageUser } from "@/lib/auth";
import { LogoutButton } from "@/components/logout-button";

export const metadata = { title: "Dashboard · LifeLine" };

const ROLE_LABEL = { ADMIN: "Administrator", BANK: "Blood bank", HOSPITAL: "Hospital", DONOR: "Donor" } as const;

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ denied?: string }> }) {
  const actor = await requirePageUser();
  const { denied } = await searchParams;

  return (
    <main className="mx-auto w-full max-w-3xl p-4 sm:p-8">
      <header className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Welcome, {actor.name}</h1>
          <p className="text-muted-foreground">Signed in as {ROLE_LABEL[actor.role]}</p>
        </div>
        <LogoutButton />
      </header>
      {denied && (
        <p role="alert" className="mt-4 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm">
          You do not have access to that page.
        </p>
      )}
      <p className="mt-8 text-muted-foreground">Role dashboards arrive in the next steps.</p>
    </main>
  );
}
