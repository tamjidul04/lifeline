import type { RequestStatus } from "@prisma/client";
import { HttpError } from "./errors";

/**
 * Blood request state machine. Anything not listed is illegal.
 *   OPEN -> MATCHED | PARTIAL | UNFULFILLABLE | CANCELLED
 *   MATCHED -> DELIVERED | CANCELLED
 *   PARTIAL -> DELIVERED | CANCELLED
 *   UNFULFILLABLE -> CANCELLED
 *   DELIVERED, CANCELLED: terminal
 */
export const TRANSITIONS: Readonly<Record<RequestStatus, readonly RequestStatus[]>> = {
  OPEN: ["MATCHED", "PARTIAL", "UNFULFILLABLE", "CANCELLED"],
  MATCHED: ["DELIVERED", "CANCELLED"],
  PARTIAL: ["DELIVERED", "CANCELLED"],
  UNFULFILLABLE: ["CANCELLED"],
  DELIVERED: [],
  CANCELLED: [],
};

export const canTransition = (from: RequestStatus, to: RequestStatus) => TRANSITIONS[from].includes(to);

export function assertTransition(from: RequestStatus, to: RequestStatus): void {
  if (!canTransition(from, to)) {
    throw new HttpError(409, `A ${from.toLowerCase()} request cannot become ${to.toLowerCase()}.`, "ILLEGAL_TRANSITION", { from, to });
  }
}

export const isTerminal = (s: RequestStatus) => TRANSITIONS[s].length === 0;
