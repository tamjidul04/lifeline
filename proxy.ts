import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySession } from "@/lib/session";

// Optimistic checks only (cookie signature + expiry). Real authorization happens in every
// Route Handler and page via requireUser()/requirePageUser(), against the database.
const PROTECTED = ["/dashboard", "/inventory", "/requests", "/admin", "/demo"];
const AUTH_PAGES = ["/login", "/register"];

export async function proxy(req: NextRequest) {
  const path = req.nextUrl.pathname;
  const session = await verifySession(req.cookies.get(SESSION_COOKIE)?.value);

  if (PROTECTED.some((p) => path === p || path.startsWith(`${p}/`)) && !session) {
    const url = new URL("/login", req.nextUrl);
    url.searchParams.set("next", path);
    return NextResponse.redirect(url);
  }
  if (AUTH_PAGES.includes(path) && session) {
    return NextResponse.redirect(new URL("/dashboard", req.nextUrl));
  }
  return NextResponse.next();
}

export const config = {
  // API routes do their own 401/403 JSON handling; skip static assets.
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:png|svg|jpg|ico)$).*)"],
};
