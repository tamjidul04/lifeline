import type { BloodType, Component, Urgency } from "@prisma/client";
import { abo, BLOOD_TYPE_ORDER, type Abo } from "./blood";

/**
 * THE authoritative compatibility tables (PLAN.md "REVIEW AMENDMENTS"). Every other rule in the
 * app references these; nothing restates compatibility. Each cell is unit-tested.
 */

/** RBC: recipient -> donor types it can receive. An Rh-negative recipient NEVER receives Rh+. */
export const RBC_CAN_RECEIVE: Readonly<Record<BloodType, readonly BloodType[]>> = {
  O_NEG: ["O_NEG"],
  O_POS: ["O_POS", "O_NEG"],
  A_NEG: ["A_NEG", "O_NEG"],
  A_POS: ["A_POS", "A_NEG", "O_POS", "O_NEG"],
  B_NEG: ["B_NEG", "O_NEG"],
  B_POS: ["B_POS", "B_NEG", "O_POS", "O_NEG"],
  AB_NEG: ["AB_NEG", "A_NEG", "B_NEG", "O_NEG"],
  AB_POS: ["AB_POS", "AB_NEG", "A_POS", "A_NEG", "B_POS", "B_NEG", "O_POS", "O_NEG"],
};

/** Plasma: ABO only (Rh ignored), reverse direction of RBC. AB plasma is the universal donor. */
export const PLASMA_CAN_RECEIVE_ABO: Readonly<Record<Abo, readonly Abo[]>> = {
  O: ["O", "A", "B", "AB"],
  A: ["A", "AB"],
  B: ["B", "AB"],
  AB: ["AB"],
};

export type Compatibility = {
  /** Preferred match: identical type (RBC), or identical ABO group (plasma, platelets; Rh ignored). */
  exact: BloodType[];
  /** Clinically acceptable substitutes. Whether they may be USED depends on urgency (see policy). */
  substitutes: BloodType[];
};

/** Donor unit types that may be given to `recipient` for `component`, split into exact vs substitute. */
export function compatibleTypes(recipient: BloodType, component: Component): Compatibility {
  let allowed: BloodType[];
  let exact: BloodType[];
  switch (component) {
    case "RBC":
      allowed = [...RBC_CAN_RECEIVE[recipient]];
      exact = [recipient];
      break;
    case "PLASMA": {
      const groups = PLASMA_CAN_RECEIVE_ABO[abo(recipient)];
      allowed = BLOOD_TYPE_ORDER.filter((t) => groups.includes(abo(t)));
      exact = BLOOD_TYPE_ORDER.filter((t) => abo(t) === abo(recipient));
      break;
    }
    case "PLATELETS":
      // ABO-identical preferred, any type acceptable as a substitute; Rh ignored.
      allowed = [...BLOOD_TYPE_ORDER];
      exact = BLOOD_TYPE_ORDER.filter((t) => abo(t) === abo(recipient));
      break;
  }
  return { exact, substitutes: allowed.filter((t) => !exact.includes(t)) };
}

export function isCompatible(unitType: BloodType, recipient: BloodType, component: Component): boolean {
  const c = compatibleTypes(recipient, component);
  return c.exact.includes(unitType) || c.substitutes.includes(unitType);
}

/** Can a whole-blood donor of `donor` type help a patient of `recipient` type (RBC table)? */
export const donorCanGiveTo = (donor: BloodType, recipient: BloodType) => RBC_CAN_RECEIVE[recipient].includes(donor);

/**
 * Urgency decides WHETHER substitutes may be used and how far away a unit may come from.
 * It never changes WHICH types are compatible.
 */
export const URGENCY_POLICY: Readonly<
  Record<Urgency, { allowSubstitutes: boolean; maxExactKm: number; maxSubstituteKm: number; label: string }>
> = {
  CRITICAL: { allowSubstitutes: true, maxExactKm: Infinity, maxSubstituteKm: Infinity, label: "critical" },
  URGENT: { allowSubstitutes: true, maxExactKm: Infinity, maxSubstituteKm: 50, label: "urgent" },
  ROUTINE: { allowSubstitutes: false, maxExactKm: 50, maxSubstituteKm: 0, label: "routine" },
};

export const URGENCY_ORDER: readonly Urgency[] = ["ROUTINE", "URGENT", "CRITICAL"];
