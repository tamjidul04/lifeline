import { Suspense } from "react";
import { AuthForm } from "@/components/auth-form";
import { SiteFooter, SiteHeader } from "@/components/ll/site";

export const metadata = { title: "Sign in · LifeLine" };

export default function LoginPage() {
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
