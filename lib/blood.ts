import type { BloodType, Component } from "@prisma/client";

/** Explicit human order. Never sort the enum alphabetically (that gives AB before A). */
export const BLOOD_TYPE_ORDER: readonly BloodType[] = ["O_NEG", "O_POS", "A_NEG", "A_POS", "B_NEG", "B_POS", "AB_NEG", "AB_POS"];

const LABEL: Record<BloodType, string> = {
  O_NEG: "O−", O_POS: "O+", A_NEG: "A−", A_POS: "A+", B_NEG: "B−", B_POS: "B+", AB_NEG: "AB−", AB_POS: "AB+",
};

const COMPONENT_LABEL: Record<Component, string> = { RBC: "red cells", PLASMA: "plasma", PLATELETS: "platelets" };

/** Display label for UI and explanations: "O−", never "O_NEG". */
export const bloodTypeLabel = (t: BloodType) => LABEL[t];
export const componentLabel = (c: Component) => COMPONENT_LABEL[c];

export type Abo = "O" | "A" | "B" | "AB";
export const abo = (t: BloodType): Abo => t.split("_")[0] as Abo;
export const isRhNegative = (t: BloodType) => t.endsWith("_NEG");
