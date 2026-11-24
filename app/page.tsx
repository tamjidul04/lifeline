import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center gap-6 p-4 sm:p-8">
      <p className="text-sm font-medium tracking-wide text-teal-700">LifeLine</p>
      <h1 className="text-3xl font-semibold leading-tight sm:text-4xl">
        The right blood, to the right hospital, before it expires.
      </h1>
      <p className="max-w-xl text-lg text-muted-foreground">
        Hospitals request blood. A rule engine matches compatible, soonest-expiring units across banks, reserves them
        atomically so no unit is ever promised twice, and explains every decision.
      </p>
      <div className="flex flex-col gap-3 sm:flex-row">
        <Button render={<Link href="/login" />}>Sign in</Button>
        <Button variant="outline" render={<Link href="/register" />}>
          Register as a donor
        </Button>
      </div>
    </main>
  );
}
