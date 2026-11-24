import { NextResponse, type NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { ZodError } from "zod";
import { HttpError } from "./errors";

type ErrorBody = { error: { code: string; message: string; details?: unknown } };

export function errorResponse(status: number, code: string, message: string, details?: unknown, headers?: HeadersInit) {
  const body: ErrorBody = { error: { code, message, ...(details !== undefined ? { details } : {}) } };
  return NextResponse.json(body, { status, headers });
}

const DB_UNAVAILABLE = new Set(["P1001", "P1002", "P1008", "P1017", "P2024"]);

/** Map any thrown value to a safe JSON error response. Never leaks stack traces. */
export function toErrorResponse(err: unknown): NextResponse {
  if (err instanceof HttpError) {
    const headers = err.status === 429 && typeof err.details === "object" && err.details && "retryAfterSeconds" in err.details
      ? { "Retry-After": String((err.details as { retryAfterSeconds: number }).retryAfterSeconds) }
      : undefined;
    return errorResponse(err.status, err.code, err.message, err.details, headers);
  }
  if (err instanceof ZodError) {
    const fields = err.issues.map((i) => ({ field: i.path.join(".") || "(body)", message: i.message }));
    return errorResponse(400, "VALIDATION_FAILED", "Some fields are invalid.", fields);
  }
  if (err instanceof SyntaxError) {
    return errorResponse(400, "INVALID_JSON", "Request body must be valid JSON.");
  }
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2002") return errorResponse(409, "DUPLICATE", "This record already exists.");
    if (err.code === "P2025") return errorResponse(404, "NOT_FOUND", "Record not found.");
    if (err.code === "P2034") return errorResponse(409, "WRITE_CONFLICT", "Another update happened at the same time. Please retry.");
    if (DB_UNAVAILABLE.has(err.code)) return dbUnavailable();
  }
  if (err instanceof Prisma.PrismaClientInitializationError) return dbUnavailable();

  console.error("[api] unhandled error", err);
  return errorResponse(500, "INTERNAL", "Something went wrong on our side. Please try again.");
}

function dbUnavailable() {
  return errorResponse(503, "DB_UNAVAILABLE", "The database is waking up or unreachable. Please retry in a few seconds.", undefined, {
    "Retry-After": "5",
  });
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * CSRF defence-in-depth. The primary control is the SameSite=Lax session cookie: browsers do not
 * attach it to cross-site POST/PATCH/DELETE. On top of that, for state-changing requests:
 * - Sec-Fetch-Site: cross-site  -> blocked (modern browsers always send this header)
 * - an Origin from another host  -> blocked
 * A request with neither header did not come from a browser page, so it is not a CSRF vector;
 * such a client still needs a valid session cookie, which is revocable server-side.
 */
export function assertSameOrigin(req: NextRequest) {
  if (SAFE_METHODS.has(req.method)) return;
  if (req.headers.get("sec-fetch-site") === "cross-site") throw new HttpError(403, "Cross-site request blocked.", "CSRF");
  const origin = req.headers.get("origin");
  if (!origin) return;
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    throw new HttpError(403, "Cross-site request blocked.", "CSRF");
  }
  if (originHost !== host) throw new HttpError(403, "Cross-site request blocked.", "CSRF");
}

/**
 * Wrap a Route Handler: same-origin check, JSON responses, and uniform error mapping.
 * The handler may return a plain object (sent as 200 JSON) or a Response.
 */
export function handle<C>(fn: (req: NextRequest, ctx: C) => Promise<unknown>) {
  return async (req: NextRequest, ctx: C): Promise<Response> => {
    try {
      assertSameOrigin(req);
      const result = await fn(req, ctx);
      if (result instanceof Response) return result;
      return NextResponse.json(result ?? { ok: true });
    } catch (err) {
      return toErrorResponse(err);
    }
  };
}

/** Parse a JSON body; an empty or malformed body becomes a 400. */
export async function readJson(req: NextRequest): Promise<unknown> {
  const text = await req.text();
  if (!text.trim()) return {};
  return JSON.parse(text);
}
