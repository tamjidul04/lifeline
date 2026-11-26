import type { BloodType, Component, RequestStatus, Urgency } from "@prisma/client";
import type { MatchPlan } from "@/lib/rules";

/** JSON shapes returned by the API (dates arrive as strings). */
export type ReservationDTO = {
  id: string;
  status: "ACTIVE" | "DELIVERED" | "RELEASED";
  reason: string | null;
  createdAt: string;
  deliveredAt: string | null;
  releasedAt: string | null;
  unit: { id: string; bankId: string; bloodType: BloodType; component: Component; expiresAt: string; bank: { name: string } };
};

export type RequestDTO = {
  id: string;
  bloodType: BloodType;
  component: Component;
  unitsRequested: number;
  urgency: Urgency;
  status: RequestStatus;
  createdAt: string;
  hospital: { id: string; name: string };
  explanation: (Pick<MatchPlan, "summary" | "swaps" | "alternatives"> & { decidedAt: string }) | null;
  reservations: ReservationDTO[];
};
