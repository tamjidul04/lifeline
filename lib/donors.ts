import type { BloodType } from "@prisma/client";
import { donorCanGiveTo } from "./compat";
import { distanceKm, type Point } from "./geo";

export const DONOR_COOLDOWN_DAYS = 90;
const DAY = 24 * 60 * 60 * 1000;

/**
 * Whole-blood donors must wait 90 days between donations.
 * - never donated (null) -> eligible
 * - a date in the future is treated as bad data and ignored (-> eligible), so a typo can never
 *   lock a donor out permanently
 * - exactly 90 days -> eligible
 */
export function donorEligibility(lastDonationAt: Date | null, now: Date): { eligible: boolean; daysUntilEligible: number } {
  if (!lastDonationAt || lastDonationAt.getTime() > now.getTime()) return { eligible: true, daysUntilEligible: 0 };
  const eligibleAt = lastDonationAt.getTime() + DONOR_COOLDOWN_DAYS * DAY;
  const remaining = eligibleAt - now.getTime();
  return remaining <= 0 ? { eligible: true, daysUntilEligible: 0 } : { eligible: false, daysUntilEligible: Math.ceil(remaining / DAY) };
}

export type DonorCandidate = { id: string; name: string; bloodType: BloodType; lastDonationAt: Date | null; lat: number; lng: number };

/**
 * Eligible whole-blood donors whose RED CELLS this patient can receive, nearest first
 * (deterministic tie-break by id). A donor is a red-cell source, so the RBC table always applies;
 * callers only offer donors for RBC shortfalls.
 */
export function suggestDonors(recipient: BloodType, hospital: Point, donors: readonly DonorCandidate[], now: Date, limit = 5) {
  return donors
    .filter((d) => donorCanGiveTo(d.bloodType, recipient) && donorEligibility(d.lastDonationAt, now).eligible)
    .map((d) => ({ id: d.id, name: d.name, bloodType: d.bloodType, km: distanceKm(hospital, d) }))
    .sort((a, b) => a.km - b.km || a.id.localeCompare(b.id))
    .slice(0, limit);
}
