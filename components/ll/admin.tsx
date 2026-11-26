"use client";

import { useCallback, useEffect, useState } from "react";
import { api, describeError } from "./client-api";
import { sentence, when } from "./ui";

type User = { id: string; name: string; email: string; role: string; bank: { name: string } | null; hospital: { name: string } | null };
type Entry = { id: string; actorLabel: string | null; action: string; entity: string; detail: unknown; createdAt: string };
type Audit = { page: number; total: number; totalPages: number; entries: Entry[] };

const NEW_STAFF = { name: "", email: "", password: "", role: "HOSPITAL", orgName: "", lat: "23.78", lng: "90.40" };
const ACTIONS = ["REQUEST_CREATED", "REQUEST_CANCELLED", "UNIT_DELIVERED", "UNITS_ADDED", "UNIT_RETIRED", "USER_CREATED", "REGISTER", "LOGIN", "LOGIN_FAILED", "LOGOUT", "DEMO_RESET"];

export function Admin() {
  const [users, setUsers] = useState<User[] | null>(null);
  const [audit, setAudit] = useState<Audit | null>(null);
  const [filter, setFilter] = useState({ action: "", q: "" });
  const [page, setPage] = useState(1);
  const [staff, setStaff] = useState(NEW_STAFF);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);

  const loadUsers = useCallback(async () => {
    const res = await api<{ users: User[] }>("/api/admin/users");
    if (res.ok) setUsers(res.data.users);
    else setError(describeError(res.error));
  }, []);

  const loadAudit = useCallback(async () => {
    const q = new URLSearchParams({ page: String(page), pageSize: "15" });
    if (filter.action) q.set("action", filter.action);
    if (filter.q) q.set("q", filter.q);
    const res = await api<Audit>(`/api/admin/audit?${q}`);
    if (res.ok) setAudit(res.data);
    else setError(describeError(res.error));
  }, [filter, page]);

  useEffect(() => {
    const t = setTimeout(loadUsers, 0);
    return () => clearTimeout(t);
  }, [loadUsers]);
  useEffect(() => {
    const t = setTimeout(loadAudit, 250);
    return () => clearTimeout(t);
  }, [loadAudit]);

  async function createStaff(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setErrors({});
    setError(null);
    setNotice(null);
    const res = await api("/api/admin/users", {
      method: "POST",
      body: JSON.stringify({ ...staff, lat: Number(staff.lat), lng: Number(staff.lng) }),
    });
    if (res.ok) {
      setNotice(`Account created for ${staff.email}.`);
      setStaff(NEW_STAFF);
      await Promise.all([loadUsers(), loadAudit()]);
    } else {
      setErrors(res.error.fields);
      setError(describeError(res.error));
    }
    setBusy(false);
  }

  async function reset() {
    setBusy(true);
    setError(null);
    const res = await api("/api/admin/reset", { method: "POST" });
    // A full reload is intentional: the reset ended every session.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    if (res.ok) window.location.assign("/login");
    else {
      setError(describeError(res.error));
      setBusy(false);
      setConfirmReset(false);
    }
  }

  const input = (name: keyof typeof NEW_STAFF, label: string, type = "text") => (
    <label className="block text-[13px]">
      <span className="ll-muted block">{label}</span>
      <input className="ll-input" type={type} autoComplete="off" value={staff[name]} aria-invalid={!!errors[name]} onChange={(e) => setStaff((s) => ({ ...s, [name]: e.target.value }))} />
      {errors[name] && <span className="ll-error block">{errors[name]}</span>}
    </label>
  );

  return (
    <>
      <h1 className="ll-h1">Administration</h1>
      <div aria-live="polite">
        {notice && <p className="ll-alert ll-alert-ok mt-3">{notice}</p>}
        {error && <p role="alert" className="ll-alert ll-alert-error mt-3">{error}</p>}
      </div>

      <div className="mt-4 grid items-start gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <section className="ll-sheet" aria-labelledby="users-title">
          <h2 id="users-title" className="ll-h2">Accounts</h2>
          {!users ? <p className="ll-muted">Loading…</p> : (
            <div className="ll-scroll mt-2" tabIndex={0}>
              <table className="ll-table">
                <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Organisation</th></tr></thead>
                <tbody>
                  {users.map((u) => (
                    <tr key={u.id}><td>{u.name}</td><td>{u.email}</td><td>{sentence(u.role)}</td><td>{u.bank?.name ?? u.hospital?.name ?? ""}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <div className="grid gap-4">
          <form className="ll-sheet grid gap-2" onSubmit={createStaff} noValidate>
            <h2 className="ll-h2">New staff account</h2>
            <label className="block text-[13px]">
              <span className="ll-muted block">Role</span>
              <select className="ll-input" value={staff.role} onChange={(e) => setStaff((s) => ({ ...s, role: e.target.value }))}>
                <option value="HOSPITAL">Hospital staff</option>
                <option value="BANK">Blood bank manager</option>
              </select>
            </label>
            {input("name", "Full name")}
            {input("email", "Email", "email")}
            {input("password", "Temporary password", "password")}
            {input("orgName", "Organisation name")}
            <div className="grid grid-cols-2 gap-2">{input("lat", "Latitude", "number")}{input("lng", "Longitude", "number")}</div>
            <button className="ll-btn" disabled={busy}>Create account</button>
          </form>

          <section className="ll-sheet" aria-labelledby="reset-title">
            <h2 id="reset-title" className="ll-h2">Reset demo data</h2>
            <p className="ll-muted my-2 text-sm">Restores the seeded accounts and stock, removes everything added since, and signs everyone out.</p>
            {confirmReset ? (
              <div className="flex flex-wrap gap-2">
                <button className="ll-btn" disabled={busy} onClick={reset}>{busy ? "Resetting…" : "Yes, reset everything"}</button>
                <button className="ll-btn ll-btn-quiet" disabled={busy} onClick={() => setConfirmReset(false)}>Cancel</button>
              </div>
            ) : (
              <button className="ll-btn ll-btn-quiet" onClick={() => setConfirmReset(true)}>Reset demo data</button>
            )}
          </section>
        </div>
      </div>

      <section className="ll-sheet mt-4" aria-labelledby="audit-title">
        <h2 id="audit-title" className="ll-h2">Audit log</h2>
        <div className="my-3 flex flex-wrap gap-2">
          <label className="min-w-0 flex-1 basis-44 text-[13px]">
            <span className="ll-muted block">Action</span>
            <select className="ll-input" value={filter.action} onChange={(e) => { setFilter((f) => ({ ...f, action: e.target.value })); setPage(1); }}>
              <option value="">All actions</option>
              {ACTIONS.map((a) => <option key={a} value={a}>{sentence(a.replaceAll("_", " "))}</option>)}
            </select>
          </label>
          <label className="min-w-0 flex-[2] basis-52 text-[13px]">
            <span className="ll-muted block">Search by person or record id</span>
            <input className="ll-input" value={filter.q} onChange={(e) => { setFilter((f) => ({ ...f, q: e.target.value })); setPage(1); }} />
          </label>
        </div>
        {!audit ? <p className="ll-muted">Loading…</p> : audit.entries.length === 0 ? <p className="ll-muted">No entries match.</p> : (
          <div className="ll-scroll" tabIndex={0}>
            <table className="ll-table">
              <thead><tr><th>When</th><th>Who</th><th>Action</th><th>Detail</th></tr></thead>
              <tbody>
                {audit.entries.map((e) => (
                  <tr key={e.id}>
                    <td className="ll-mono whitespace-nowrap text-[13px]">{when(e.createdAt)}</td>
                    <td>{e.actorLabel ?? "unknown"}</td>
                    <td>{sentence(e.action.replaceAll("_", " "))}</td>
                    <td className="ll-mono ll-muted max-w-[420px] text-xs">{e.detail ? JSON.stringify(e.detail) : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {audit && (
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button className="ll-btn ll-btn-quiet ll-btn-sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</button>
            <span className="ll-muted text-sm">Page {audit.page} of {audit.totalPages} · {audit.total} entries</span>
            <button className="ll-btn ll-btn-quiet ll-btn-sm" disabled={page >= audit.totalPages} onClick={() => setPage((p) => p + 1)}>Next</button>
          </div>
        )}
      </section>
    </>
  );
}
