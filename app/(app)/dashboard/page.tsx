import Link from "next/link";
import { requirePageUser } from "@/lib/auth";
import { dashboardFor } from "@/lib/stats";
import { bloodTypeLabel } from "@/lib/blood";
import { DONOR_COOLDOWN_DAYS } from "@/lib/donors";
import { FridgeRack, Readout, sentence } from "@/components/ll/ui";

export const metadata = { title: "Overview · LifeLine" };

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ denied?: string }> }) {
  const actor = await requirePageUser();
  const { denied } = await searchParams;
  const data = await dashboardFor(actor);

  return (
    <>
      <p className="ll-eyebrow">Signed in as {actor.name}</p>
      <h1 className="ll-h1">Overview</h1>
      {denied && <p role="alert" className="ll-alert ll-alert-error mt-3">You do not have access to that page.</p>}

      {"stock" in data && data.stock && (
        <>
          <Readout
            items={[
              { k: "usable units", v: data.stock.total },
              { k: "expire within 24 h", v: data.stock.expiringWithin24h },
              { k: "expire within 48 h", v: data.stock.expiringWithin48h },
              ...("reservationsAwaitingDelivery" in data ? [{ k: "held, awaiting delivery", v: data.reservationsAwaitingDelivery }] : []),
              ...("fulfilmentRatePercent" in data
                ? [{ k: "fulfilment: delivered ÷ closed", v: data.fulfilmentRatePercent === null ? "n/a" : `${data.fulfilmentRatePercent}%` }]
                : []),
            ]}
          />
          <section className="ll-sheet" aria-labelledby="rack-title">
            <h2 id="rack-title" className="ll-h2">Fridge rack</h2>
            <p className="ll-muted mb-3 text-sm">Usable stock only: expired, held and retired bags are never counted.</p>
            <FridgeRack cells={data.stock.byTypeAndComponent} />
            <p className="mt-4"><Link className="ll-btn" href="/inventory">Open stock list</Link></p>
          </section>
        </>
      )}

      {"requestsByStatus" in data && data.requestsByStatus && (
        <section className="ll-sheet mt-4" aria-labelledby="req-title">
          <h2 id="req-title" className="ll-h2">Requests by status</h2>
          {Object.keys(data.requestsByStatus).length === 0 ? (
            <p className="ll-muted mt-2">No requests yet.</p>
          ) : (
            <Readout items={Object.entries(data.requestsByStatus).map(([k, v]) => ({ k: sentence(k), v }))} />
          )}
          <div className="mt-3 flex flex-wrap gap-3">
            {actor.role === "HOSPITAL" && <Link className="ll-btn" href="/requests/new">New blood request</Link>}
            <Link className="ll-btn ll-btn-quiet" href="/requests">View requests</Link>
          </div>
        </section>
      )}

      {"usersByRole" in data && data.usersByRole && (
        <section className="ll-sheet mt-4" aria-labelledby="usr-title">
          <h2 id="usr-title" className="ll-h2">People and records</h2>
          <Readout
            items={[
              ...Object.entries(data.usersByRole).map(([k, v]) => ({ k: `${sentence(k)} accounts`, v })),
              { k: "audit entries", v: data.auditEntries },
            ]}
          />
        </section>
      )}

      {"donor" in data && data.donor && (
        <section className="ll-sheet mt-4 max-w-xl" aria-labelledby="donor-title">
          <h2 id="donor-title" className="ll-h2">Donation eligibility</h2>
          <Readout
            items={[
              { k: "your blood group", v: bloodTypeLabel(data.donor.bloodType) },
              { k: "last donation", v: data.donor.lastDonationAt ? data.donor.lastDonationAt.toISOString().slice(0, 10) : "never" },
            ]}
          />
          {data.donor.eligible ? (
            <p className="ll-alert ll-alert-ok">You can donate now.</p>
          ) : (
            <p className="ll-alert">
              You can donate again in {data.donor.daysUntilEligible} day(s). Whole-blood donors wait {DONOR_COOLDOWN_DAYS} days.
            </p>
          )}
        </section>
      )}
    </>
  );
}
