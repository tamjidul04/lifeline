import { Suspense } from "react";
import { AuthForm } from "@/components/auth-form";
import { SiteFooter, SiteHeader } from "@/components/ll/site";

export const metadata = { title: "Register · LifeLine" };

export default function RegisterPage() {
  return (
    <>
      <SiteHeader />
      <main className="flex flex-1 items-center justify-center bg-[var(--paper)] p-4 py-14">
        <Suspense>
          <AuthForm mode="register" />
        </Suspense>
      </main>
      <SiteFooter />
    </>
  );
}
