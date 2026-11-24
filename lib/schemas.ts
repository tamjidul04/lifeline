import * as z from "zod";

// Shared by API routes and (later) client forms, so validation is written once.

export const BLOOD_TYPES = ["O_NEG", "O_POS", "A_NEG", "A_POS", "B_NEG", "B_POS", "AB_NEG", "AB_POS"] as const;

export const emailSchema = z
  .string({ error: "Email is required." })
  .trim()
  .toLowerCase()
  .max(254, { error: "Email is too long." })
  .pipe(z.email({ error: "Enter a valid email address." }));

// bcrypt only uses the first 72 bytes, so cap the length (same cap for sign-up and login).
const MAX_PASSWORD = 72;

export const newPasswordSchema = z
  .string({ error: "Password is required." })
  .min(8, { error: "Password must be at least 8 characters." })
  .max(MAX_PASSWORD, { error: `Password must be at most ${MAX_PASSWORD} characters.` })
  .regex(/[a-zA-Z]/, { error: "Password must contain a letter." })
  .regex(/[0-9]/, { error: "Password must contain a number." });

const nameSchema = z
  .string({ error: "Name is required." })
  .trim()
  .min(2, { error: "Name must be at least 2 characters." })
  .max(80, { error: "Name must be at most 80 characters." });

const latSchema = z.number({ error: "Latitude must be a number." }).min(-90).max(90);
const lngSchema = z.number({ error: "Longitude must be a number." }).min(-180).max(180);

export const loginSchema = z.object({
  email: emailSchema,
  password: z
    .string({ error: "Password is required." })
    .min(1, { error: "Password is required." })
    .max(MAX_PASSWORD, { error: "Invalid email or password." }),
});

/**
 * Public self-registration. Always creates a DONOR: any `role` field in the body is ignored
 * (z.object strips unknown keys), so self-registration cannot escalate privileges.
 */
export const registerSchema = z.object({
  name: nameSchema,
  email: emailSchema,
  password: newPasswordSchema,
  bloodType: z.enum(BLOOD_TYPES, { error: "Choose a valid blood type." }),
  lat: latSchema.optional(),
  lng: lngSchema.optional(),
});

/** Admin-only: create a bank manager or hospital staff account with its organisation. */
export const createStaffSchema = z.object({
  name: nameSchema,
  email: emailSchema,
  password: newPasswordSchema,
  role: z.enum(["BANK", "HOSPITAL"], { error: "Role must be BANK or HOSPITAL." }),
  orgName: z.string().trim().min(2, { error: "Organisation name is required." }).max(100),
  lat: latSchema,
  lng: lngSchema,
});

export const COMPONENTS = ["RBC", "PLASMA", "PLATELETS"] as const;
export const URGENCIES = ["CRITICAL", "URGENT", "ROUTINE"] as const;
export const REQUEST_STATUSES = ["OPEN", "MATCHED", "PARTIAL", "DELIVERED", "CANCELLED", "UNFULFILLABLE"] as const;

export const createRequestSchema = z.object({
  bloodType: z.enum(BLOOD_TYPES, { error: "Choose a valid blood type." }),
  component: z.enum(COMPONENTS, { error: "Choose red cells, plasma or platelets." }),
  unitsRequested: z
    .number({ error: "Units must be a number." })
    .int({ error: "Units must be a whole number." })
    .min(1, { error: "Request at least 1 unit." })
    .max(20, { error: "At most 20 units per request." }),
  urgency: z.enum(URGENCIES, { error: "Choose critical, urgent or routine." }),
});

/** Client-generated key (e.g. a UUID per form submission). Same key + same body = safe replay. */
export const idempotencyKeySchema = z
  .string({ error: "Idempotency-Key header is required." })
  .trim()
  .min(8, { error: "Idempotency-Key must be 8-128 characters." })
  .max(128, { error: "Idempotency-Key must be 8-128 characters." })
  .regex(/^[A-Za-z0-9._:-]+$/, { error: "Idempotency-Key may only contain letters, digits and . _ : -" });

export const listRequestsSchema = z.object({
  status: z.enum(REQUEST_STATUSES).optional(),
  urgency: z.enum(URGENCIES).optional(),
  bloodType: z.enum(BLOOD_TYPES).optional(),
  sort: z.enum(["newest", "oldest"]).default("newest"),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export type CreateRequestInput = z.infer<typeof createRequestSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type RegisterInput = z.infer<typeof registerSchema>;
export type CreateStaffInput = z.infer<typeof createStaffSchema>;
