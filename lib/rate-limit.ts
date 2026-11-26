/**
 * Client IP that the client cannot forge on Vercel: x-real-ip and x-vercel-forwarded-for are set
 * by the platform. Falls back to the RIGHT-most x-forwarded-for entry (appended by the nearest
 * proxy); the left-most entry is client-controlled and must never be trusted.
 */
export function clientIpFrom(headers: Headers): string {
  const real = headers.get("x-real-ip") ?? headers.get("x-vercel-forwarded-for");
  if (real) return real.split(",")[0].trim();
  const xff = headers.get("x-forwarded-for");
  if (xff) return xff.split(",").at(-1)!.trim();
  return "local";
}
