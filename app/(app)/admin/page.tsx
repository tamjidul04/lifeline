import { requirePageUser } from "@/lib/auth";
import { Admin } from "@/components/ll/admin";

export const metadata = { title: "Admin · LifeLine" };

export default async function AdminPage() {
  await requirePageUser(["ADMIN"]);
  return <Admin />;
}
