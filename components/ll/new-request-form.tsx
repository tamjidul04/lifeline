"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { Urgency } from "@prisma/client";
import { bloodTypeLabel, componentLabel } from "@/lib/blood";
import { BLOOD_TYPES, COMPONENTS, createRequestSchema, URGENCIES } from "@/lib/schemas";
import type { MatchPlan } from "@/lib/rules";
import { api, describeError } from "./client-api";
import { BagLabel, sentence, timeLeft } from "./ui";

const POLICY: Record<Urgency, string> = {
  CRITICAL: "Critical: exact match or any compatible substitute, from any distance.",
  URGENT: "Urgent: exact match from anywhere; substitutes only from banks within 50 km.",
  ROUTINE: "Routine: exact match only, from banks within 50 km.",
};

export function NewRequestForm() {
  const router = useRouter();
  const [form, setForm] = useState({ bloodType: "", component: "RBC", units: "1", urgency: "ROUTINE" as Urgency });
  const [preview, setPreview] = useState<{ for: string; plan?: MatchPlan; error?: string } | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  // One key per distinct form content: a double click or retry replays, an edit makes a new request.
  const idem = useRef<{ body: string; key: string }>({ body: "", key: "" });
  const sending = useRef(false);

  const payload = { bloodType: form.bloodType, component: form.component, unitsRequested: Number(form.units), urgency: form.urgency };
  const body = JSON.stringify(payload);
  const parsed = createRequestSchema.safeParse(payload);
  const valid = parsed.success;

  useEffect(() => {
    if (!valid) return;
    let stale = false;
    const t = setTimeout(async () => {
      const res = await api<{ plan: MatchPlan }>("/api/requests/preview", { method: "POST", body });
      if (!stale) setPreview(res.ok ? { for: body, plan: res.data.plan } : { for: body, error: describeError(res.error) });
    }, 350);
    return () => {
      stale = true;
      clearTimeout(t);
    };
  }, [body, valid]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (sending.current) return;
    setError(null);
    if (!parsed.success) {
      const fe: Record<string, string> = {};
      for (const i of parsed.error.issues) fe[String(i.path[0])] ??= i.message;
      setFieldErrors(fe);
      return;
    }
    setFieldErrors({});
    if (idem.current.body !== body) idem.current = { body, key: crypto.randomUUID() };
    sending.current = true;
    setPending(true);
    const res = await api<{ request: { id: string } }>("/api/requests", { method: "POST", body, headers: { "idempotency-key": idem.current.key } });
    if (res.ok) {
      router.push(`/requests?id=${res.data.request.id}`);
      router.refresh();
      return;
    }
    setFieldErrors(res.error.fields);
    setError(describeError(res.error));
    sending.current = false;
    setPending(false);
  }

  const set = (patch: Partial<typeof form>) => {
    setForm((f) => ({ ...f, ...patch }));
    setFieldErrors({});
    setError(null);
  };
  const err = (name: string) => fieldErrors[name] && <p id={`${name}-error`} className="ll-error">{fieldErrors[name]}</p>;
  const plan = valid && preview?.for === body ? preview.plan : undefined;

  return (
    <div className="mt-4 grid items-start gap-5 md:grid-cols-2">
      <form className="ll-sheet" onSubmit={submit} noValidate>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className="ll-label" htmlFor="bloodType">Patient blood group</label>
            <select id="bloodType" className="ll-input" value={form.bloodType} onChange={(e) => set({ bloodType: e.target.value })} aria-invalid={!!fieldErrors.bloodType}>
              <option value="" disabled>Select the confirmed group</option>
              {BLOOD_TYPES.map((t) => <option key={t} value={t}>{bloodTypeLabel(t)}</option>)}
            </select>
            {err("bloodType")}
          </div>
          <div>
            <label className="ll-label" htmlFor="component">Component</label>
            <select id="component" className="ll-input" value={form.component} onChange={(e) => set({ component: e.target.value })}>
              {COMPONENTS.map((c) => <option key={c} value={c}>{sentence(componentLabel(c))}</option>)}
            </select>
          </div>
          <div>
            <label className="ll-label" htmlFor="units">Units</label>
            <input id="units" className="ll-input" type="number" inputMode="numeric" min={1} max={20} value={form.units} onChange={(e) => set({ units: e.target.value })} aria-invalid={!!fieldErrors.unitsRequested} aria-describedby="units-hint" />
            <p id="units-hint" className="ll-hint">1 to 20 per request</p>
            {err("unitsRequested")}
          </div>
          <fieldset className="sm:col-span-2">
            <legend className="ll-label">Urgency</legend>
            <div className="grid grid-cols-3 overflow-hidden rounded border-[1.5px]">
              {URGENCIES.map((u) => (
                <label key={u} className={`flex min-h-11 cursor-pointer items-center justify-center border-r px-1 text-center last:border-r-0 focus-within:outline-3 focus-within:outline-[#f0b429] ${form.urgency === u ? "bg-[var(--ink)] font-bold text-white" : "bg-white"}`}>
                  <input type="radio" name="urgency" value={u} className="sr-only" checked={form.urgency === u} onChange={() => set({ urgency: u })} />
                  {sentence(u)}
                </label>
              ))}
            </div>
            <p className="ll-hint">{POLICY[form.urgency]}</p>
          </fieldset>
        </div>
        <div role="alert" aria-live="assertive">{error && <p className="ll-alert ll-alert-error mt-4">{error}</p>}</div>
        <div className="mt-4 flex flex-wrap items-center gap-3 border-t pt-3.5">
          <button className="ll-btn" type="submit" disabled={pending}>{pending ? "Reserving…" : "Submit and reserve"}</button>
          <span className="ll-muted text-sm">Pressing twice still creates one request.</span>
        </div>
      </form>

      <section className="ll-sheet" aria-live="polite" aria-labelledby="preview-title">
        <h2 id="preview-title" className="ll-eyebrow">Engine preview (nothing is held yet)</h2>
        {!valid ? (
          <p className="ll-muted mt-2">Choose a blood group and a valid number of units to see what would be reserved.</p>
        ) : preview?.for === body && preview.error ? (
          <p className="ll-alert ll-alert-error mt-2">{preview.error}</p>
        ) : !plan ? (
          <p className="ll-muted mt-2">Checking current stock…</p>
        ) : (
          <>
            <p className="mt-2">
              <span className={`ll-state ll-state-${plan.status}`}>{plan.picks.length} of {plan.requested} would be reserved</span>
            </p>
            <p className="my-3 rounded bg-[var(--paper)] px-3 py-2.5">{plan.summary}</p>
            <div className="ll-labels">
              {plan.picks.map((p) => (
                <BagLabel key={p.unitId} type={p.bloodType} component={parsed.data!.component} substitute={!p.exact} top={`exp ${timeLeft(p.hoursLeft)}`}>
                  <span>{p.bankName} · {p.km} km</span>
                  <span className="ll-muted">{p.exact ? "Exact match" : "Compatible substitute"} · score {p.score.toFixed(2)}</span>
                </BagLabel>
              ))}
            </div>
            {plan.alternatives.length > 0 && (
              <>
                <h3 className="ll-eyebrow mb-1.5 mt-4">Options</h3>
                <ol className="list-decimal space-y-1 pl-5">{plan.alternatives.map((a, i) => <li key={i}>{a.message}</li>)}</ol>
              </>
            )}
            {plan.swaps.map((s) => <p key={s} className="ll-muted mt-2 text-sm">Optimised: {s}</p>)}
          </>
        )}
      </section>
    </div>
  );
}
