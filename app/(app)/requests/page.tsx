import { Suspense } from "react";
import { requirePageUser } from "@/lib/auth";
import { RequestsBoard } from "@/components/ll/requests-board";

export const metadata = { title: "Requests · LifeLine" };

export default async function RequestsPage() {
  const actor = await requirePageUser(["HOSPITAL", "BANK", "ADMIN"]);
  return (
    <Suspense fallback={<p className="ll-muted">Loading requests…</p>}>
      <RequestsBoard role={actor.role} />
    </Suspense>
  );
}
