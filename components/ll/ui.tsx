import type { BloodType, Component, Urgency } from "@prisma/client";
import { abo, BLOOD_TYPE_ORDER, bloodTypeLabel, componentLabel, isRhNegative } from "@/lib/blood";

export const sentence = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
export const componentName = (c: Component) => sentence(componentLabel(c));
export const groupClass = (t: BloodType) => `ll-g${abo(t)}`;

export function timeLeft(hours: number): string {
  if (hours <= 0) return "expired";
  if (hours < 48) return `in ${Math.floor(hours)} h`;
  return `in ${Math.floor(hours / 24)} d`;
}

export function ago(iso: string, now = Date.now()): string {
  const mins = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60_000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  if (mins < 48 * 60) return `${Math.round(mins / 60)} h ago`;
  return `${Math.round(mins / 1440)} d ago`;
}

export const when = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export const Severity = ({ u }: { u: Urgency }) => <span className={`ll-sev ll-sev-${u}`}>{sentence(u)}</span>;
export const State = ({ s }: { s: string }) => <span className={`ll-state ll-state-${s}`}>{sentence(s)}</span>;

export function Readout({ items }: { items: { k: string; v: React.ReactNode }[] }) {
  return (
    <div className="ll-readout my-4">
      {items.map((i) => (
        <div key={i.k}>
          <div className="v">{i.v}</div>
          <div className="k">{i.k}</div>
        </div>
      ))}
    </div>
  );
}

/** One blood unit drawn like a bag label. A dashed border marks a compatible substitute. */
export function BagLabel({ type, component, substitute, top, children }: {
  type: BloodType; component: Component; substitute?: boolean; top?: string; children?: React.ReactNode;
}) {
  return (
    <div className={`ll-bag ${substitute ? "ll-bag-sub" : ""}`}>
      <div className={`grp ${groupClass(type)}`}>
        <span aria-hidden="true">{abo(type)}</span>
        <span className="sr-only">{bloodTypeLabel(type)}</span>
        <small aria-hidden="true">{isRhNegative(type) ? "Rh neg" : "Rh pos"}</small>
      </div>
      <div className="grid min-w-0 content-start gap-1 p-2.5 text-[13px]">
        <div className="flex flex-wrap justify-between gap-2">
          <b className="text-sm">{componentName(component)}</b>
          {top && <span className="ll-mono ll-muted">{top}</span>}
        </div>
        {children}
      </div>
    </div>
  );
}

const ROWS: Component[] = ["RBC", "PLASMA", "PLATELETS"];

/** Usable stock as a fridge rack: one mark per bag. */
export function FridgeRack({ cells }: { cells: { bloodType: BloodType; component: Component; count: number }[] }) {
  const count = (t: BloodType, c: Component) => cells.find((x) => x.bloodType === t && x.component === c)?.count ?? 0;
  return (
    <div className="ll-scroll" tabIndex={0} aria-label="Usable units by component and blood group">
      <div className="ll-rack" role="table">
        <div role="row" className="contents">
          <div className="colh" role="columnheader"><span className="sr-only">Component</span></div>
          {BLOOD_TYPE_ORDER.map((t) => (
            <div key={t} className={`colh ${groupClass(t)}`} role="columnheader">{bloodTypeLabel(t)}</div>
          ))}
        </div>
        {ROWS.map((c) => (
          <div key={c} role="row" className="contents">
            <div className="rowh" role="rowheader">{componentName(c)}</div>
            {BLOOD_TYPE_ORDER.map((t) => {
              const n = count(t, c);
              const out = n === 0 && c === "RBC";
              return (
                <div key={t} role="cell" className={`cell ${out ? "out" : ""}`} aria-label={`${bloodTypeLabel(t)} ${componentLabel(c)}: ${n} units`}>
                  <div className="ll-pips" aria-hidden="true">{Array.from({ length: Math.min(n, 24) }, (_, i) => <i key={i} />)}</div>
                  <div className="ll-mono mt-1 text-[13px]">{out ? "out" : n}</div>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
