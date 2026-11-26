import { requirePageUser } from "@/lib/auth";
import { Inventory } from "@/components/ll/inventory";

export const metadata = { title: "Stock · LifeLine" };

export default async function InventoryPage() {
  const actor = await requirePageUser(["BANK", "ADMIN"]);
  return <Inventory canEdit={actor.role === "BANK"} />;
}
