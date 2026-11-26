"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";

const BLOOD_TYPE_OPTIONS = [
  ["O_NEG", "O−"], ["O_POS", "O+"], ["A_NEG", "A−"], ["A_POS", "A+"],
  ["B_NEG", "B−"], ["B_POS", "B+"], ["AB_NEG", "AB−"], ["AB_POS", "AB+"],
] as const;

type FieldErrors = Record<string, string>;

/** Only allow redirects to local paths after sign-in (no open redirect). */
function safeNext(next: string | null) {
  return next && next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard";
}

export function AuthForm({ mode }: { mode: "login" | "register" }) {
  const router = useRouter();
  const params = useSearchParams();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return; // ignore double submits
    setPending(true);
    setMessage(null);
    setFieldErrors({});

    const form = new FormData(e.currentTarget);
    const body: Record<string, string> = {};
    form.forEach((v, k) => (body[k] = String(v)));

    try {
      const res = await fetch(`/api/auth/${mode}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        router.push(safeNext(params.get("next")));
        router.refresh();
        return;
      }
      const data = await res.json().catch(() => null);
      const err = data?.error;
      if (Array.isArray(err?.details)) {
        const fe: FieldErrors = {};
        for (const d of err.details) fe[d.field] ??= d.message;
        setFieldErrors(fe);
      }
      setMessage(err?.message ?? "Something went wrong. Please try again.");
    } catch {
      setMessage("Network error. Check your connection and try again.");
    } finally {
      setPending(false);
    }
  }

  const isLogin = mode === "login";
  const field = (name: string, label: string, type = "text", autoComplete?: string) => (
    <div className="grid gap-1.5">
      <Label htmlFor={name}>{label}</Label>
      <Input
        id={name}
        name={name}
        type={type}
        autoComplete={autoComplete}
        required
        aria-invalid={!!fieldErrors[name]}
        aria-describedby={fieldErrors[name] ? `${name}-error` : undefined}
      />
      {fieldErrors[name] && (
        <p id={`${name}-error`} className="text-sm text-red-700">
          {fieldErrors[name]}
        </p>
      )}
    </div>
  );

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle>
          <h1 className="ll-h2">{isLogin ? "Sign in to LifeLine" : "Register as a donor"}</h1>
        </CardTitle>
        <CardDescription>
          {isLogin
            ? "Hospital, blood bank, donor and admin accounts."
            : "Hospital and blood bank accounts are created by an administrator."}
        </CardDescription>
      </CardHeader>
      <form onSubmit={onSubmit} noValidate>
        <CardContent className="grid gap-4">
          {!isLogin && field("name", "Full name", "text", "name")}
          {field("email", "Email", "email", "email")}
          {field("password", "Password", "password", isLogin ? "current-password" : "new-password")}
          {!isLogin && (
            <div className="grid gap-1.5">
              <Label htmlFor="bloodType">Blood type</Label>
              <select
                id="bloodType"
                name="bloodType"
                required
                defaultValue=""
                className="h-9 rounded-md border bg-background px-3 text-sm focus-visible:outline-2 focus-visible:outline-blue-600"
                aria-invalid={!!fieldErrors.bloodType}
              >
                <option value="" disabled>
                  Select…
                </option>
                {BLOOD_TYPE_OPTIONS.map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
              {fieldErrors.bloodType && <p className="text-sm text-red-700">{fieldErrors.bloodType}</p>}
            </div>
          )}
          <p role="alert" aria-live="assertive" className="min-h-5 text-sm text-red-700">
            {message}
          </p>
        </CardContent>
        <CardFooter className="flex flex-col gap-3">
          <Button type="submit" className="w-full" disabled={pending}>
            {pending ? "Please wait…" : isLogin ? "Sign in" : "Create donor account"}
          </Button>
          <p className="text-sm text-muted-foreground">
            {isLogin ? (
              <>
                New donor? <Link className="underline" href="/register">Register</Link>
              </>
            ) : (
              <>
                Have an account? <Link className="underline" href="/login">Sign in</Link>
              </>
            )}
          </p>
        </CardFooter>
      </form>
    </Card>
  );
}
