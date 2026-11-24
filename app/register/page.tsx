import { Suspense } from "react";
import { AuthForm } from "@/components/auth-form";

export const metadata = { title: "Register · LifeLine" };

export default function RegisterPage() {
  return (
    <main className="flex flex-1 items-center justify-center p-4">
      <Suspense>
        <AuthForm mode="register" />
      </Suspense>
    </main>
  );
}
