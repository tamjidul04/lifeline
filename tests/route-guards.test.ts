import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Safety net: every API route must authenticate via requireUser(), unless it is deliberately
 * public and listed here. A new route that forgets its guard fails this test.
 */
const PUBLIC_ROUTES = new Set([
  "app/api/health/route.ts", // liveness check, exposes no data
  "app/api/auth/login/route.ts",
  "app/api/auth/register/route.ts", // creates DONOR only
  "app/api/auth/logout/route.ts", // ends the caller's own session
]);

function routeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return routeFiles(p);
    return name === "route.ts" ? [p] : [];
  });
}

const root = fileURLToPath(new URL("..", import.meta.url));
const files = routeFiles(join(root, "app", "api")).map((f) => relative(root, f).replaceAll("\\", "/"));

describe("API route guards", () => {
  it("finds the API routes", () => expect(files.length).toBeGreaterThan(0));

  it.each(files)("%s is guarded or explicitly public", (file) => {
    const src = readFileSync(join(root, file), "utf8");
    if (PUBLIC_ROUTES.has(file)) return;
    expect(src, `${file} must call requireUser()`).toMatch(/requireUser\(/);
  });

  it.each(files)("%s wraps every handler in handle() (CSRF + safe errors)", (file) => {
    const src = readFileSync(join(root, file), "utf8");
    const exported = [...src.matchAll(/export (?:const|async function) (GET|POST|PATCH|PUT|DELETE)\b/g)];
    const wrapped = [...src.matchAll(/export const (GET|POST|PATCH|PUT|DELETE) = handle\(/g)];
    if (file === "app/api/health/route.ts") return; // read-only GET with its own error handling
    expect(wrapped.length, `${file}: every handler should be handle(...)`).toBe(exported.length);
  });
});
