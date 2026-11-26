"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import type { Role } from "@prisma/client";
import { bloodTypeLabel, componentLabel } from "@/lib/blood";
import { BLOOD_TYPES, REQUEST_STATUSES, URGENCIES } from "@/lib/schemas";
import { api, describeError } from "./client-api";
import { ago, BagLabel, sentence, Severity, State, timeLeft, when } from "./ui";
import type { RequestDTO } from "./types";

const REFRESH_MS = 15_000;
const URGENCY_RANK = { CRITICAL: 0, URGENT: 1, ROUTINE: 2 } as const;
const CLOSED = new Set(["DELIVERED", "CANCELLED"]);

const title = (r: RequestDTO) => `${bloodTypeLabel(r.bloodType)} ${componentLabel(r.component)} × ${r.unitsRequested}`;
const held = (r: RequestDTO) => r.reservations.filter((x) => x.status !== "RELEASED");

function Meter({ r }: { r: RequestDTO }) {
  const live = held(r);
  const delivered = live.filter((x) => x.status === "DELIVERED").length;
  return (
    <span className="ll-meter" role="img" aria-label={`${live.length} of ${r.unitsRequested} units reserved, ${delivered} delivered`}>
      {Array.from({ length: r.unitsRequested }, (_, i) => <i key={i} className={i < delivered ? "done" : i < live.length ? "on" : ""} />)}
      <span className="ll-mono ll-muted ml-1.5 text-[13px]">{live.length}/{r.unitsRequested}</span>
    </span>
  );
}

export function RequestsBoard({ role }: { role: Role }) {
  const router = useRouter();
  const selectedId = useSearchParams().get("id");
  const [filters, setFilters] = useState({ status: "", urgency: "", bloodType: "", sort: "urgency" });
  const [requests, setRequests] = useState<RequestDTO[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState<string | null>(null);
  // "Now" is captured when data arrives, so rendering stays pure.
  const [now, setNow] = useState(0);

  const load = useCallback(async () => {
    const q = new URLSearchParams({ limit: "100", sort: filters.sort === "oldest" ? "oldest" : "newest" });
    if (filters.status) q.set("status", filters.status);
    if (filters.urgency) q.set("urgency", filters.urgency);
    if (filters.bloodType) q.set("bloodType", filters.bloodType);
    const res = await api<{ requests: RequestDTO[] }>(`/api/requests?${q}`);
    if (res.ok) {
      setRequests(res.data.requests);
      setNow(Date.now());
      setError(null);
    } else setError(describeError(res.error));
  }, [filters]);

  useEffect(() => {
    const first = setTimeout(load, 0);
    const timer = setInterval(() => document.visibilityState === "visible" && load(), REFRESH_MS);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [load]);

  // "Most urgent first": open work before closed, then urgency, then oldest waiting.
  const ordered =
    requests && filters.sort === "urgency"
      ? [...requests].sort(
          (a, b) =>
            Number(CLOSED.has(a.status)) - Number(CLOSED.has(b.status)) ||
            URGENCY_RANK[a.urgency] - URGENCY_RANK[b.urgency] ||
            a.createdAt.localeCompare(b.createdAt),
        )
      : requests;
  const selected = ordered?.find((r) => r.id === selectedId) ?? ordered?.[0] ?? null;

  async function act(path: string, done: string) {
    if (busy) return;
    setBusy(true);
    setNotice(null);
    setError(null);
    const res = await api(path, { method: "POST" });
    if (res.ok) setNotice(done);
    else setError(describeError(res.error));
    setConfirmCancel(null);
    await load();
    setBusy(false);
  }

  const filter = (key: keyof typeof filters, label: string, options: readonly (readonly [string, string])[]) => (
    <label className="min-w-0 flex-1 basis-32 text-[13px]">
      <span className="ll-muted block">{label}</span>
      <select className="ll-input" value={filters[key]} onChange={(e) => setFilters((f) => ({ ...f, [key]: e.target.value }))}>
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </label>
  );

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="ll-h1">Blood requests</h1>
        {role === "HOSPITAL" && <Link href="/requests/new" className="ll-btn">New blood request</Link>}
      </div>

      <div className="my-4 flex flex-wrap gap-2">
        {filter("status", "Status", [["", "All"], ...REQUEST_STATUSES.map((s) => [s, sentence(s)] as const)])}
        {filter("urgency", "Urgency", [["", "All"], ...URGENCIES.map((s) => [s, sentence(s)] as const)])}
        {filter("bloodType", "Blood group", [["", "All"], ...BLOOD_TYPES.map((s) => [s, bloodTypeLabel(s)] as const)])}
        {filter("sort", "Sort", [["urgency", "Most urgent first"], ["newest", "Newest first"], ["oldest", "Oldest first"]])}
      </div>

      <div aria-live="polite">
        {notice && <p className="ll-alert ll-alert-ok mb-3">{notice}</p>}
        {error && (
          <p role="alert" className="ll-alert ll-alert-error mb-3">
            {error} <button className="underline" onClick={load}>Try again</button>
          </p>
        )}
      </div>

      {!ordered ? (
        <p className="ll-muted">Loading requests…</p>
      ) : ordered.length === 0 ? (
        <div className="ll-sheet">
          <p>No requests match these filters.</p>
          {role === "BANK" && <p className="ll-muted mt-1 text-sm">A bank sees a request once one of its bags is held for it.</p>}
        </div>
      ) : (
        <div className="grid items-start gap-5 lg:grid-cols-[minmax(290px,380px)_minmax(0,1fr)]">
          <section className="ll-sheet !p-0" aria-label="Request queue">
            <p className="ll-muted border-b px-3.5 py-2.5 text-[13px]">{ordered.length} request(s) · refreshes every 15 s</p>
            <ol className="ll-queue max-h-[70vh] overflow-y-auto">
              {ordered.map((r) => (
                <li key={r.id}>
                  <button aria-current={selected?.id === r.id} onClick={() => router.replace(`/requests?id=${r.id}`, { scroll: false })}>
                    <Severity u={r.urgency} />
                    <span className="ll-muted text-right text-[13px]">{ago(r.createdAt, now)}</span>
                    <b>{title(r)}</b>
                    <State s={r.status} />
                    <span className="col-span-2">
                      <Meter r={r} />
                      {role !== "HOSPITAL" && <span className="ll-muted block text-[13px]">{r.hospital.name}</span>}
                    </span>
                  </button>
                </li>
              ))}
            </ol>
          </section>

          {selected && (
            <article className="ll-sheet" aria-labelledby="open-title">
              <div className="flex flex-wrap items-start justify-between gap-3 border-b pb-3.5">
                <div>
                  <h2 id="open-title" className="ll-h1 !text-[26px]">{title(selected)}</h2>
                  <p className="ll-muted mt-1.5 flex flex-wrap items-center gap-3 text-sm">
                    <Severity u={selected.urgency} />
                    <State s={selected.status} />
                    <span>{selected.hospital.name}</span>
                    <span>{when(selected.createdAt)}</span>
                  </p>
                </div>
                {role === "HOSPITAL" && !CLOSED.has(selected.status) &&
                  (confirmCancel === selected.id ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm">Release held units?</span>
                      <button className="ll-btn ll-btn-sm" disabled={busy} onClick={() => act(`/api/requests/${selected.id}/cancel`, "Request cancelled. Held units went back to stock.")}>Yes, cancel it</button>
                      <button className="ll-btn ll-btn-quiet ll-btn-sm" onClick={() => setConfirmCancel(null)}>Keep it</button>
                    </div>
                  ) : (
                    <button className="ll-btn ll-btn-quiet" onClick={() => setConfirmCancel(selected.id)}>Cancel request</button>
                  ))}
              </div>

              {selected.explanation && (
                <p className="my-3.5 rounded bg-[var(--paper)] px-3 py-2.5">
                  {selected.explanation.summary}
                </p>
              )}

              {role !== "BANK" && selected.explanation && selected.explanation.alternatives.length > 0 && selected.status !== "CANCELLED" && (
                <div className="mb-4">
                  <h3 className="ll-eyebrow mb-1.5">Options when this was decided</h3>
                  <ol className="list-decimal space-y-1 pl-5">
                    {selected.explanation.alternatives.map((a, i) => <li key={i}>{a.message}</li>)}
                  </ol>
                </div>
              )}
              {selected.explanation?.swaps.map((s) => <p key={s} className="ll-muted mb-2 text-sm">Optimised: {s}</p>)}

              <h3 className="ll-eyebrow mb-2">{role === "BANK" ? "Your bags held for this request" : "Units for this request"}</h3>
              {selected.reservations.length === 0 ? (
                <p className="ll-muted">No units are reserved.</p>
              ) : (
                <div className="ll-labels">
                  {selected.reservations.map((x) => (
                    <BagLabel
                      key={x.id}
                      type={x.unit.bloodType}
                      component={x.unit.component}
                      substitute={x.reason?.includes("substitute")}
                      top={x.status === "ACTIVE" ? `exp ${timeLeft((new Date(x.unit.expiresAt).getTime() - now) / 3_600_000)}` : undefined}
                    >
                      <span>{x.unit.bank.name}</span>
                      <span>
                        <b>{x.status === "ACTIVE" ? "Held" : x.status === "DELIVERED" ? `Delivered ${x.deliveredAt ? when(x.deliveredAt) : ""}` : "Released to stock"}</b>
                      </span>
                      {x.reason && <span className="ll-muted">{x.reason}</span>}
                      {role === "BANK" && x.status === "ACTIVE" && (
                        <button className="ll-btn ll-btn-sm mt-1 justify-self-start" disabled={busy} onClick={() => act(`/api/reservations/${x.id}/deliver`, "Marked as delivered.")}>
                          Mark delivered
                        </button>
                      )}
                    </BagLabel>
                  ))}
                </div>
              )}
            </article>
          )}
        </div>
      )}
    </>
  );
}
