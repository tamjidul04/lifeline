"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { BloodType, Component } from "@prisma/client";
import { bloodTypeLabel, componentLabel } from "@/lib/blood";
import { BLOOD_TYPES, COMPONENTS } from "@/lib/schemas";
import { api, describeError } from "./client-api";
import { componentName, sentence, State, timeLeft, when } from "./ui";

type Unit = {
  id: string;
  bloodType: BloodType;
  component: Component;
  expiresAt: string;
  hoursLeft: number;
  status: string;
  version: number;
  bank: { id: string; name: string };
  reservedForRequestId: string | null;
};
type Page = { page: number; total: number; totalPages: number; units: Unit[] };

const EMPTY = { q: "", bloodType: "", component: "", status: "AVAILABLE", expiringWithinHours: "", sort: "expiry_asc" };
const dateInput = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

export function Inventory({ canEdit }: { canEdit: boolean }) {
  const [filters, setFilters] = useState(EMPTY);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Page | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [adding, setAdding] = useState({ bloodType: "O_POS", component: "RBC", quantity: "1", date: dateInput(21) });
  const [addErrors, setAddErrors] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    const q = new URLSearchParams({ page: String(page), pageSize: "20" });
    for (const [k, v] of Object.entries(filters)) if (v) q.set(k, v);
    const res = await api<Page>(`/api/units?${q}`);
    if (res.ok) {
      setData(res.data);
      setError(null);
    } else setError(describeError(res.error));
  }, [filters, page]);

  useEffect(() => {
    const t = setTimeout(load, filters.q ? 300 : 0);
    return () => clearTimeout(t);
  }, [load, filters.q]);

  const set = (patch: Partial<typeof EMPTY>) => {
    setFilters((f) => ({ ...f, ...patch }));
    setPage(1);
  };

  async function run(request: () => Promise<{ ok: boolean; message: string }>) {
    if (busy) return;
    setBusy(true);
    setNotice(null);
    setError(null);
    const r = await request();
    await load();
    if (r.ok) setNotice(r.message);
    else setError(r.message);
    setConfirm(null);
    setBusy(false);
  }

  const addUnits = (e: React.FormEvent) => {
    e.preventDefault();
    setAddErrors({});
    run(async () => {
      const expires = new Date(`${adding.date}T23:59:00`);
      const res = await api<{ added: number }>("/api/units", {
        method: "POST",
        body: JSON.stringify({
          bloodType: adding.bloodType,
          component: adding.component,
          quantity: Number(adding.quantity),
          expiresAt: Number.isNaN(expires.getTime()) ? "" : expires.toISOString(),
        }),
      });
      if (res.ok) return { ok: true, message: `Added ${res.data.added} unit(s).` };
      setAddErrors(res.error.fields);
      return { ok: false, message: describeError(res.error) };
    });
  };

  const retire = (u: Unit) =>
    run(async () => {
      const res = await api(`/api/units/${u.id}`, { method: "PATCH", body: JSON.stringify({ action: "RETIRE", version: u.version }) });
      return res.ok ? { ok: true, message: "Unit retired. It no longer counts as stock." } : { ok: false, message: describeError(res.error) };
    });

  const select = (key: keyof typeof EMPTY, label: string, options: readonly (readonly [string, string])[]) => (
    <label className="min-w-0 flex-1 basis-32 text-[13px]">
      <span className="ll-muted block">{label}</span>
      <select className="ll-input" value={filters[key]} onChange={(e) => set({ [key]: e.target.value })}>
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </label>
  );

  const addField = (name: "quantity" | "date", label: string, type: string) => (
    <label className="min-w-0 flex-1 basis-32 text-[13px]">
      <span className="ll-muted block">{label}</span>
      <input className="ll-input" type={type} min={name === "quantity" ? 1 : undefined} max={name === "quantity" ? 50 : undefined} value={adding[name]} onChange={(e) => setAdding((a) => ({ ...a, [name]: e.target.value }))} />
    </label>
  );

  return (
    <>
      <h1 className="ll-h1">{canEdit ? "Bank stock" : "All stock"}</h1>
      {!canEdit && <p className="ll-muted mt-1">Administrators can view stock. Only the owning bank can change it.</p>}

      <div aria-live="polite">
        {notice && <p className="ll-alert ll-alert-ok mt-3">{notice}</p>}
        {error && <p role="alert" className="ll-alert ll-alert-error mt-3">{error}</p>}
      </div>

      {canEdit && (
        <form className="ll-sheet mt-4" onSubmit={addUnits} noValidate>
          <h2 className="ll-h2">Add units</h2>
          <div className="mt-2 flex flex-wrap items-end gap-2">
            <label className="min-w-0 flex-1 basis-24 text-[13px]">
              <span className="ll-muted block">Blood group</span>
              <select className="ll-input" value={adding.bloodType} onChange={(e) => setAdding((a) => ({ ...a, bloodType: e.target.value }))}>
                {BLOOD_TYPES.map((t) => <option key={t} value={t}>{bloodTypeLabel(t)}</option>)}
              </select>
            </label>
            <label className="min-w-0 flex-1 basis-32 text-[13px]">
              <span className="ll-muted block">Component</span>
              <select className="ll-input" value={adding.component} onChange={(e) => setAdding((a) => ({ ...a, component: e.target.value }))}>
                {COMPONENTS.map((c) => <option key={c} value={c}>{sentence(componentLabel(c))}</option>)}
              </select>
            </label>
            {addField("quantity", "Quantity (1-50)", "number")}
            {addField("date", "Expiry date", "date")}
            <button className="ll-btn" disabled={busy}>Add to stock</button>
          </div>
          {Object.entries(addErrors).map(([k, v]) => <p key={k} className="ll-error">{v}</p>)}
        </form>
      )}

      <section className="ll-sheet mt-4" aria-labelledby="units-title">
        <h2 id="units-title" className="ll-h2">Units</h2>
        <div className="my-3 flex flex-wrap items-end gap-2">
          <label className="min-w-0 flex-[3] basis-52 text-[13px]">
            <span className="ll-muted block">Search by group or bank</span>
            <input className="ll-input" value={filters.q} placeholder="e.g. ab- or riverside" onChange={(e) => set({ q: e.target.value })} />
          </label>
          {select("bloodType", "Group", [["", "All"], ...BLOOD_TYPES.map((t) => [t, bloodTypeLabel(t)] as const)])}
          {select("component", "Component", [["", "All"], ...COMPONENTS.map((c) => [c, sentence(componentLabel(c))] as const)])}
          {select("status", "Status", [["", "All"], ...["AVAILABLE", "RESERVED", "ISSUED", "EXPIRED", "RETIRED"].map((s) => [s, sentence(s)] as const)])}
          {select("expiringWithinHours", "Expiring", [["", "Any time"], ["24", "Within 24 h"], ["48", "Within 48 h"], ["168", "Within 7 days"]])}
          {select("sort", "Sort", [["expiry_asc", "Expiry: soonest"], ["expiry_desc", "Expiry: latest"], ["type", "Blood group"], ["newest", "Newest added"]])}
          <button className="ll-btn ll-btn-quiet" type="button" onClick={() => set(EMPTY)}>Reset</button>
        </div>

        {!data ? (
          <p className="ll-muted">Loading stock…</p>
        ) : data.units.length === 0 ? (
          <p className="ll-muted">No units match these filters.</p>
        ) : (
          <div className="ll-scroll" tabIndex={0}>
            <table className="ll-table">
              <thead>
                <tr><th>Group</th><th>Component</th><th>Expires</th>{!canEdit && <th>Bank</th>}<th>Status</th><th>Action</th></tr>
              </thead>
              <tbody>
                {data.units.map((u) => (
                  <tr key={u.id}>
                    <td><b>{bloodTypeLabel(u.bloodType)}</b></td>
                    <td>{componentName(u.component)}</td>
                    <td className="ll-mono">
                      <span className={u.hoursLeft > 0 && u.hoursLeft <= 24 ? "font-bold text-[var(--warn)]" : ""}>{timeLeft(u.hoursLeft)}</span>
                      <span className="ll-muted block text-xs">{when(u.expiresAt)}</span>
                    </td>
                    {!canEdit && <td>{u.bank.name}</td>}
                    <td><State s={u.status} /></td>
                    <td>
                      {u.status === "RESERVED" && u.reservedForRequestId ? (
                        <Link className="underline" href={`/requests?id=${u.reservedForRequestId}`}>Open request</Link>
                      ) : canEdit && (u.status === "AVAILABLE" || u.status === "EXPIRED") ? (
                        confirm === u.id ? (
                          <span className="flex flex-wrap gap-1">
                            <button className="ll-btn ll-btn-sm" disabled={busy} onClick={() => retire(u)}>Confirm retire</button>
                            <button className="ll-btn ll-btn-quiet ll-btn-sm" onClick={() => setConfirm(null)}>Keep</button>
                          </span>
                        ) : (
                          <button className="ll-btn ll-btn-quiet ll-btn-sm" onClick={() => setConfirm(u.id)}>Retire</button>
                        )
                      ) : (
                        <span className="ll-muted">none</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {data && (
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button className="ll-btn ll-btn-quiet ll-btn-sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</button>
            <span className="ll-muted text-sm">Page {data.page} of {data.totalPages} · {data.total} unit(s)</span>
            <button className="ll-btn ll-btn-quiet ll-btn-sm" disabled={page >= data.totalPages} onClick={() => setPage((p) => p + 1)}>Next</button>
          </div>
        )}
      </section>
    </>
  );
}
