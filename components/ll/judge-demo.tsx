"use client";

import { useState } from "react";
import type { RaceResult, Scenario } from "@/lib/demo";
import type { MatchPlan } from "@/lib/rules";
import { api, describeError } from "./client-api";

type Decision = { title: string; description: string; plan: MatchPlan };

export function JudgeDemo() {
  const [race, setRace] = useState<RaceResult | null>(null);
  const [decision, setDecision] = useState<Decision | null>(null);
  const [running, setRunning] = useState<"race" | Scenario | null>(null);
  const [errors, setErrors] = useState<{ race?: string; decision?: string }>({});

  async function runRace() {
    setRunning("race");
    setRace(null);
    setErrors({});
    const res = await api<{ race: RaceResult }>("/api/demo/race", { method: "POST" });
    if (res.ok) setRace(res.data.race);
    else setErrors({ race: describeError(res.error) });
    setRunning(null);
  }

  async function runDecision(scenario: Scenario) {
    setRunning(scenario);
    setDecision(null);
    setErrors({});
    const res = await api<Decision>("/api/demo/decision", { method: "POST", body: JSON.stringify({ scenario }) });
    if (res.ok) setDecision(res.data);
    else setErrors({ decision: describeError(res.error) });
    setRunning(null);
  }

  return (
    <div className="mt-4 grid items-start gap-4 lg:grid-cols-2">
      <section className="ll-sheet" aria-labelledby="race-title">
        <h2 id="race-title" className="ll-h2">A05 · The last unit</h2>
        <p className="my-2">Ten hospitals ask for the only AB− red cell unit at the same moment. This calls the real reservation code against the real database, on temporary data that is deleted afterwards.</p>
        <button className="ll-btn" disabled={running !== null} onClick={runRace}>{running === "race" ? "Racing…" : "Run the race"}</button>
        <div className="ll-trace mt-3" aria-live="polite">
          {errors.race ? errors.race : running === "race" ? "10 requests in flight…" : !race ? "Waiting to run." : (
            <>
              {race.hospitals.map((h) => (
                <div key={h.name} className={h.unitReserved ? "text-[#7ee2a8]" : "text-[#9fb1c3]"}>
                  {h.name.padEnd(12, " ")} {h.status.padEnd(14, " ")} {h.milliseconds} ms{h.unitReserved ? "  ← got the unit" : ""}
                </div>
              ))}
              <div className="mt-2 font-medium text-white">
                {race.passed ? "PASS" : "FAIL"}: {race.winners} winner · {race.liveReservationsOnUnit} live reservation on the unit · {race.unitsDoubleBooked} double-booked units in the whole database · {race.totalMilliseconds} ms
              </div>
              <div className="mt-2 text-[#9fb1c3]">Each refused hospital was answered at once: “{race.hospitals.find((h) => !h.unitReserved)?.summary.split(". ")[0].replace(/.$/, "")}.”</div>
            </>
          )}
        </div>
      </section>

      <section className="ll-sheet" aria-labelledby="dec-title">
        <h2 id="dec-title" className="ll-h2">A02 · Requests that cannot be met</h2>
        <p className="my-2">The real matching engine runs on a fixed shelf, using the registered donors. Nothing is written.</p>
        <div className="flex flex-wrap gap-2">
          <button className="ll-btn" disabled={running !== null} onClick={() => runDecision("conflict")}>{running === "conflict" ? "Deciding…" : "Conflicting constraints"}</button>
          <button className="ll-btn" disabled={running !== null} onClick={() => runDecision("infeasible")}>{running === "infeasible" ? "Deciding…" : "Infeasible request"}</button>
        </div>
        <div className="ll-trace mt-3" aria-live="polite">
          {errors.decision ? errors.decision : !decision ? "Waiting to run." : (
            <>
              <div className="font-medium text-white">{decision.title}: {decision.plan.status}</div>
              <div className="text-[#9fb1c3]">{decision.description}</div>
              <div className="mt-2">{decision.plan.summary}</div>
              {decision.plan.picks.map((p) => <div key={p.unitId} className="text-[#7ee2a8]">+ {p.reason}</div>)}
              {Object.entries(decision.plan.rejections).map(([k, v]) => <div key={k} className="text-[#9fb1c3]">- excluded {v}: {k.toLowerCase().replaceAll("_", " ")}</div>)}
              {decision.plan.alternatives.map((a, i) => <div key={i}>→ {a.message}</div>)}
            </>
          )}
        </div>
      </section>

      <section className="ll-sheet" aria-labelledby="map-title">
        <h2 id="map-title" className="ll-h2">Where each requirement is shown</h2>
        <dl className="mt-2 grid grid-cols-[48px_minmax(0,1fr)] gap-x-3 gap-y-1.5">
          {[
            ["M01", "Request, match and reserve, deliver: New request, Requests, Bank stock"],
            ["M02", "Units, requests and reservations, with rules enforced by the database"],
            ["M03", "Four roles; one hospital cannot open another's request (it gets “not found”)"],
            ["M04", "Compatibility tables, urgency rules, allowed status changes"],
            ["M05", "Search, filters and sorting on stock and requests; stock and fulfilment figures"],
            ["M06", "Field messages, double-submit safety, “busy, retry” instead of crashes"],
            ["M07", "Phone layout, keyboard focus, status shown as shape and word"],
            ["M08", "Live site and a README with setup, design and known limits"],
          ].map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="ll-mono text-[var(--teal)]">{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="ll-sheet" aria-labelledby="edge-title">
        <h2 id="edge-title" className="ll-h2">Edge cases to try</h2>
        <ol className="mt-2 list-decimal space-y-1.5 pl-5">
          <li>As a hospital, press Submit twice quickly. One request is created.</li>
          <li>Ask for 21 units. The form explains the 1 to 20 limit.</li>
          <li>Cancel a request. Its bags return to stock and it can no longer be delivered.</li>
          <li>Request red cells for an Rh− patient. An Rh+ bag is never offered.</li>
          <li>As a bank, filter stock by “Expired”. Those bags are never reserved.</li>
        </ol>
      </section>
    </div>
  );
}
