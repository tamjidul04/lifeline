import type { BloodType, Component, Urgency } from "@prisma/client";
import { bloodTypeLabel, componentLabel } from "./blood";
import { compatibleTypes, URGENCY_ORDER, URGENCY_POLICY } from "./compat";
import { distanceKm, transitMinutes, type Point } from "./geo";
import { suggestDonors, type DonorCandidate } from "./donors";

/**
 * LifeLine matching engine (A02). Pure and deterministic: same input -> same output.
 *
 * 1. HARD constraints decide feasibility (a unit failing any one is never allocated):
 *    compatibility table, component, not expired, will not expire before it can arrive,
 *    urgency policy (substitutes allowed? distance cap?).
 * 2. SOFT preferences rank the feasible set: weighted sum of four terms, each normalised to 0..1.
 * 3. Greedy pick of the top N, then LOCAL SEARCH: single swaps that improve the set objective
 *    (score sum minus a penalty per extra bank that must deliver).
 * 4. Every pick, rejection and swap carries a human-readable reason; infeasible requests get
 *    concrete alternatives.
 */

// ---------- inputs / outputs ----------

export type RequestSpec = { bloodType: BloodType; component: Component; units: number; urgency: Urgency; hospital: Point };

export type CandidateUnit = {
  id: string;
  bankId: string;
  bankName: string;
  bankLat: number;
  bankLng: number;
  bloodType: BloodType;
  component: Component;
  expiresAt: Date;
};

export type RejectionCode =
  | "WRONG_COMPONENT"
  | "INCOMPATIBLE_TYPE"
  | "EXPIRED"
  | "EXPIRES_BEFORE_ARRIVAL"
  | "SUBSTITUTE_NOT_ALLOWED"
  | "TOO_FAR";

export type MatchPick = {
  unitId: string;
  bankId: string;
  bankName: string;
  bloodType: BloodType;
  km: number;
  hoursLeft: number;
  exact: boolean;
  score: number;
  reason: string;
};

export type Alternative =
  | { kind: "PARTIAL_NOW"; message: string; units: number }
  | { kind: "RAISE_URGENCY"; message: string; urgency: Urgency; extraUnits: number }
  | { kind: "FARTHER_BANKS"; message: string; banks: { bankId: string; bankName: string; km: number; units: number }[] }
  | { kind: "CALL_DONORS"; message: string; donors: { id: string; name: string; bloodType: BloodType; km: number }[] };

export type MatchPlan = {
  status: "MATCHED" | "PARTIAL" | "UNFULFILLABLE";
  requested: number;
  picks: MatchPick[];
  summary: string;
  rejections: Partial<Record<RejectionCode, number>>;
  swaps: string[];
  alternatives: Alternative[];
};

// ---------- tuning (one table, justified in the README) ----------

/** Soft-preference weights; sum to 1 so the score is 0..1. */
export const WEIGHTS = {
  /** Use the soonest-expiring safe unit first (FEFO) to cut wastage. Highest weight. */
  expiry: 0.35,
  /** Identical type preserves substitutes for patients who have no other option. */
  exact: 0.3,
  /** Closer units arrive sooner and fresher. */
  proximity: 0.2,
  /** Avoid spending universal donors (O− red cells, AB plasma) on patients who could take something else. */
  conserveUniversal: 0.15,
} as const;

/** Objective penalty for each additional bank that must make a delivery. */
export const EXTRA_BANK_PENALTY = 0.25;
/** Distance at which the proximity score reaches 0. */
export const PROXIMITY_HORIZON_KM = 100;
/** Shelf-life horizon per component used to normalise expiry pressure (hours). */
export const SHELF_LIFE_HOURS: Readonly<Record<Component, number>> = { RBC: 42 * 24, PLASMA: 365 * 24, PLATELETS: 5 * 24 };

const HOUR = 3_600_000;
const round = (n: number, d = 3) => Math.round(n * 10 ** d) / 10 ** d;
const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

// ---------- hard constraints ----------

type Evaluated = { unit: CandidateUnit; km: number; hoursLeft: number; exact: boolean };

/** Returns the evaluated unit, or the FIRST hard constraint it violates (checked in a fixed order). */
export function checkHardConstraints(
  unit: CandidateUnit,
  req: Pick<RequestSpec, "bloodType" | "component" | "hospital">,
  urgency: Urgency,
  now: Date,
): { ok: true; value: Evaluated } | { ok: false; code: RejectionCode } {
  if (unit.component !== req.component) return { ok: false, code: "WRONG_COMPONENT" };

  const compat = compatibleTypes(req.bloodType, req.component);
  const exact = compat.exact.includes(unit.bloodType);
  if (!exact && !compat.substitutes.includes(unit.bloodType)) return { ok: false, code: "INCOMPATIBLE_TYPE" };

  const msLeft = unit.expiresAt.getTime() - now.getTime();
  if (msLeft <= 0) return { ok: false, code: "EXPIRED" };

  const km = distanceKm(req.hospital, { lat: unit.bankLat, lng: unit.bankLng });
  if (msLeft <= transitMinutes(km) * 60_000) return { ok: false, code: "EXPIRES_BEFORE_ARRIVAL" };

  const policy = URGENCY_POLICY[urgency];
  if (!exact && !policy.allowSubstitutes) return { ok: false, code: "SUBSTITUTE_NOT_ALLOWED" };
  if (km > (exact ? policy.maxExactKm : policy.maxSubstituteKm)) return { ok: false, code: "TOO_FAR" };

  return { ok: true, value: { unit, km, hoursLeft: msLeft / HOUR, exact } };
}

// ---------- soft preferences ----------

// Both AB plasma types are universal (Rh is irrelevant for plasma), hence startsWith("AB").
const isUniversalDonorUnit = (u: CandidateUnit) =>
  (u.component === "RBC" && u.bloodType === "O_NEG") || (u.component === "PLASMA" && u.bloodType.startsWith("AB"));

export function scoreUnit(e: Evaluated, req: Pick<RequestSpec, "bloodType" | "component">) {
  const expiry = 1 - clamp01(e.hoursLeft / SHELF_LIFE_HOURS[req.component]);
  const exact = e.exact ? 1 : 0;
  const proximity = 1 - clamp01(e.km / PROXIMITY_HORIZON_KM);
  // Spending a universal unit is only "free" when the patient has the same type.
  const conserveUniversal = isUniversalDonorUnit(e.unit) && !e.exact ? 0 : 1;
  const total =
    WEIGHTS.expiry * expiry + WEIGHTS.exact * exact + WEIGHTS.proximity * proximity + WEIGHTS.conserveUniversal * conserveUniversal;
  return { total: round(total), terms: { expiry, exact, proximity, conserveUniversal } };
}

/** Deterministic order: score desc, then soonest expiry, then id. */
const byRank = (a: Ranked, b: Ranked) =>
  b.score - a.score || a.unit.expiresAt.getTime() - b.unit.expiresAt.getTime() || a.unit.id.localeCompare(b.unit.id);

type Ranked = Evaluated & { score: number };

/** Set objective: total preference minus a penalty for each extra bank that has to deliver. */
export function objective(set: readonly Ranked[]): number {
  const banks = new Set(set.map((r) => r.unit.bankId)).size;
  return set.reduce((s, r) => s + r.score, 0) - EXTRA_BANK_PENALTY * Math.max(0, banks - 1);
}

// ---------- explanations ----------

function describeUnit(r: Ranked, req: RequestSpec): string {
  const parts = [
    `${bloodTypeLabel(r.unit.bloodType)} ${componentLabel(r.unit.component)} from ${r.unit.bankName} (${r.km.toFixed(1)} km)`,
    r.exact ? "exact match" : `compatible substitute for ${bloodTypeLabel(req.bloodType)}`,
    r.hoursLeft < 24 ? `expires in ${Math.floor(r.hoursLeft)}h, so it is used first` : `expires in ${plural(Math.floor(r.hoursLeft / 24), "day")}`,
    `score ${r.score.toFixed(2)}`,
  ];
  return parts.join("; ");
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** Exclusions of units that ARE compatible; other stock (wrong type/component) is just noise in a summary. */
const NOTEWORTHY: readonly RejectionCode[] = ["EXPIRED", "EXPIRES_BEFORE_ARRIVAL", "SUBSTITUTE_NOT_ALLOWED", "TOO_FAR"];

const REJECTION_TEXT: Record<RejectionCode, string> = {
  WRONG_COMPONENT: "wrong component",
  INCOMPATIBLE_TYPE: "incompatible blood type",
  EXPIRED: "expired",
  EXPIRES_BEFORE_ARRIVAL: "would expire before it could arrive",
  SUBSTITUTE_NOT_ALLOWED: "substitute types are not allowed for this urgency",
  TOO_FAR: "beyond the distance limit for this urgency",
};
export const rejectionText = (c: RejectionCode) => REJECTION_TEXT[c];

// ---------- main entry ----------

export function planAllocation(
  req: RequestSpec,
  candidates: readonly CandidateUnit[],
  opts: { now: Date; donors?: readonly DonorCandidate[] },
): MatchPlan {
  const { now } = opts;

  // 0. One physical unit can satisfy at most one unit of a request: drop repeated ids.
  const seen = new Set<string>();
  const unique = candidates.filter((u) => (seen.has(u.id) ? false : (seen.add(u.id), true)));

  // 1. Hard constraints
  const feasible: Ranked[] = [];
  const rejections: Partial<Record<RejectionCode, number>> = {};
  for (const unit of unique) {
    const r = checkHardConstraints(unit, req, req.urgency, now);
    if (r.ok) feasible.push({ ...r.value, score: scoreUnit(r.value, req).total });
    else rejections[r.code] = (rejections[r.code] ?? 0) + 1;
  }

  // 2. Rank + greedy pick
  feasible.sort(byRank);
  let chosen = feasible.slice(0, req.units);
  const pool = feasible.slice(req.units);

  // 3. Local search: best single swap until no improvement (bounded; deterministic)
  const swaps: string[] = [];
  for (let iter = 0; iter < 50 && pool.length > 0; iter++) {
    const current = objective(chosen);
    let best: { i: number; j: number; gain: number } | null = null;
    for (let i = 0; i < chosen.length; i++) {
      for (let j = 0; j < pool.length; j++) {
        const trial = chosen.slice();
        trial[i] = pool[j];
        const gain = objective(trial) - current;
        if (gain > 1e-9 && (!best || gain > best.gain + 1e-9)) best = { i, j, gain };
      }
    }
    if (!best) break;
    const out = chosen[best.i];
    const inn = pool[best.j];
    swaps.push(
      `Swapped ${bloodTypeLabel(out.unit.bloodType)} unit from ${out.unit.bankName} for ${bloodTypeLabel(inn.unit.bloodType)} unit from ${inn.unit.bankName}: fewer banks need to deliver (objective +${best.gain.toFixed(2)}).`,
    );
    chosen = chosen.slice();
    chosen[best.i] = inn;
    pool[best.j] = out;
  }
  chosen.sort(byRank);

  const picks: MatchPick[] = chosen.map((r) => ({
    unitId: r.unit.id,
    bankId: r.unit.bankId,
    bankName: r.unit.bankName,
    bloodType: r.unit.bloodType,
    km: round(r.km, 1),
    hoursLeft: round(r.hoursLeft, 1),
    exact: r.exact,
    score: r.score,
    reason: describeUnit(r, req),
  }));

  const status = picks.length === req.units ? "MATCHED" : picks.length > 0 ? "PARTIAL" : "UNFULFILLABLE";
  const alternatives = status === "MATCHED" ? [] : buildAlternatives(req, unique, picks.length, opts);

  return {
    status,
    requested: req.units,
    picks,
    summary: summarise(req, status, picks.length, rejections),
    rejections,
    swaps,
    alternatives,
  };
}

function summarise(req: RequestSpec, status: MatchPlan["status"], got: number, rejections: MatchPlan["rejections"]): string {
  const what = `${plural(req.units, "unit")} of ${bloodTypeLabel(req.bloodType)} ${componentLabel(req.component)} (${URGENCY_POLICY[req.urgency].label})`;
  if (status === "MATCHED") return req.units === 1 ? `Matched ${what}.` : `All ${what} matched.`;
  const why = NOTEWORTHY.filter((c) => rejections[c])
    .map((c) => `${rejections[c]} ${REJECTION_TEXT[c]}`)
    .join(", ");
  const base =
    status === "PARTIAL"
      ? `Only ${got} of ${what} can be supplied now.`
      : req.units === 1
        ? `The requested ${what.replace(/^1 /, "")} cannot be supplied now.`
        : `None of the ${what} can be supplied now.`;
  const conflict =
    req.urgency === "ROUTINE" && (rejections.SUBSTITUTE_NOT_ALLOWED ?? 0) > 0
      ? got > 0
        ? " Conflicting constraints: the remaining compatible stock is substitute types only, and routine requests require an exact match."
        : " Conflicting constraints: compatible stock exists only as substitute types, but routine requests require an exact match."
      : "";
  const noStock = !why && got === 0 ? " No compatible units are in stock." : "";
  return `${base}${conflict}${why ? ` Compatible units excluded: ${why}.` : ""}${noStock}`;
}

function buildAlternatives(
  req: RequestSpec,
  candidates: readonly CandidateUnit[],
  got: number,
  opts: { now: Date; donors?: readonly DonorCandidate[] },
): Alternative[] {
  const alts: Alternative[] = [];
  const shortfall = req.units - got;

  if (got > 0) {
    alts.push({ kind: "PARTIAL_NOW", units: got, message: `${got} unit(s) are reserved now; ${shortfall} more are still needed.` });
  }

  // Would a higher urgency unlock more units? (Only suggest the lowest level that helps.)
  for (const u of URGENCY_ORDER.slice(URGENCY_ORDER.indexOf(req.urgency) + 1)) {
    const count = candidates.filter((c) => checkHardConstraints(c, req, u, opts.now).ok).length;
    const extra = Math.min(count, req.units) - got;
    if (extra > 0) {
      alts.push({
        kind: "RAISE_URGENCY",
        urgency: u,
        extraUnits: extra,
        message: `If the clinical need is ${URGENCY_POLICY[u].label}, ${extra} more compatible unit(s) can be used (substitute types and/or more distant banks).`,
      });
      break;
    }
  }

  // Compatible, in-date units that only failed the distance rule.
  const far = new Map<string, { bankId: string; bankName: string; km: number; units: number }>();
  for (const c of candidates) {
    if (checkHardConstraints(c, req, req.urgency, opts.now).ok) continue;
    const asCritical = checkHardConstraints(c, req, "CRITICAL", opts.now);
    const r = checkHardConstraints(c, req, req.urgency, opts.now);
    if (asCritical.ok && !r.ok && r.code === "TOO_FAR") {
      const e = far.get(c.bankId) ?? { bankId: c.bankId, bankName: c.bankName, km: round(asCritical.value.km, 1), units: 0 };
      e.units++;
      far.set(c.bankId, e);
    }
  }
  if (far.size > 0) {
    const banks = [...far.values()].sort((a, b) => a.km - b.km || a.bankId.localeCompare(b.bankId));
    alts.push({
      kind: "FARTHER_BANKS",
      banks,
      message: `Compatible stock exists farther away: ${banks.map((b) => `${b.units} at ${b.bankName} (${b.km} km)`).join(", ")}.`,
    });
  }

  // Whole-blood donors supply red cells, so they are only a meaningful alternative for RBC requests.
  if (req.component === "RBC" && opts.donors && opts.donors.length > 0) {
    const donors = suggestDonors(req.bloodType, req.hospital, opts.donors, opts.now).map((d) => ({ ...d, km: round(d.km, 1) }));
    if (donors.length > 0) {
      alts.push({
        kind: "CALL_DONORS",
        donors,
        message: `${donors.length} eligible donor(s) could be called: ${donors.map((d) => `${d.name} (${bloodTypeLabel(d.bloodType)}, ${d.km} km)`).join(", ")}.`,
      });
    }
  }

  return alts;
}
