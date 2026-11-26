import { requirePageUser } from "@/lib/auth";
import { NewRequestForm } from "@/components/ll/new-request-form";

export const metadata = { title: "New request · LifeLine" };

export default async function NewRequestPage() {
  await requirePageUser(["HOSPITAL"]);
  return (
    <>
      <h1 className="ll-h1">Request blood</h1>
      <p className="ll-muted mt-1.5 max-w-prose">The preview shows what the engine would reserve from current stock. Submitting reserves the units.</p>
      <NewRequestForm />
    </>
  );
}
