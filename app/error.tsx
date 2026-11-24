"use client";

import { Button } from "@/components/ui/button";

/** Friendly fallback for any unexpected page error (e.g. the database waking up). */
export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-4 p-4" role="alert">
      <h1 className="text-2xl font-semibold">Something went wrong</h1>
      <p className="text-muted-foreground">
        The service may be starting up or briefly unreachable. Your data is safe. Please try again in a few seconds.
      </p>
      <div>
        <Button onClick={() => reset()}>Try again</Button>
      </div>
    </main>
  );
}
