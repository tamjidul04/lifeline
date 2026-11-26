import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getActor } from "@/lib/auth";
import { AuthForm } from "@/components/auth-form";
import { SiteFooter, SiteHeader } from "@/components/ll/site";

export const metadata = { title: "Sign in · LifeLine" };

export default async function LoginPage() {
  // Only someone with a LIVE session (checked in the database) is sent on.
  if (await getActor()) redirect("/dashboard");

  return (
    <>
      <SiteHeader />
      <main className="flex flex-1 items-center justify-center bg-[var(--paper)] p-4 py-14">
        <Suspense>
          <AuthForm mode="login" />
        </Suspense>
      </main>
      <SiteFooter />
    </>
  );
}
