export type ApiError = { status: number; code: string; message: string; fields: Record<string, string> };
export type ApiResult<T> = { ok: true; status: number; data: T } | { ok: false; status: number; error: ApiError };

/** fetch wrapper for client components: JSON in/out, friendly errors, back to sign-in when the session ends. */
export async function api<T>(path: string, init: RequestInit = {}): Promise<ApiResult<T>> {
  try {
    const res = await fetch(path, {
      ...init,
      cache: "no-store",
      headers: { ...(init.body ? { "content-type": "application/json" } : {}), ...init.headers },
    });
    const body = await res.json().catch(() => null);
    if (res.ok) return { ok: true, status: res.status, data: body as T };
    if (res.status === 401 && !path.startsWith("/api/auth/")) {
      // A full reload is intentional: it drops all client state once the session has ended.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.assign(`/login?next=${encodeURIComponent(window.location.pathname)}`);
    }
    const fields: Record<string, string> = {};
    if (Array.isArray(body?.error?.details)) for (const d of body.error.details) fields[d.field] ??= d.message;
    return {
      ok: false,
      status: res.status,
      error: { status: res.status, code: body?.error?.code ?? "ERROR", message: body?.error?.message ?? "Something went wrong. Please try again.", fields },
    };
  } catch {
    return { ok: false, status: 0, error: { status: 0, code: "NETWORK", message: "Network problem. Check your connection and try again.", fields: {} } };
  }
}

export const describeError = (e: ApiError) =>
  Object.values(e.fields).length ? `${e.message} ${Object.values(e.fields).join(" ")}` : e.message;
