import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth/session-constants";

const PUBLIC_PATHS = new Set(["/login", "/register"]);

/**
 * Optimistic auth gate: checks only cookie *presence* for fast redirects.
 * Real session validation happens server-side in layouts and actions
 * (getCurrentUser), so a forged cookie never grants access to data.
 */
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // The liveness probe must answer monitors whether signed in or not.
  if (pathname === "/api/health") return NextResponse.next();

  const hasSessionCookie = request.cookies.has(SESSION_COOKIE);

  if (PUBLIC_PATHS.has(pathname)) {
    if (hasSessionCookie) {
      return NextResponse.redirect(new URL("/dashboard", request.url));
    }
    return NextResponse.next();
  }

  if (!hasSessionCookie) {
    const login = new URL("/login", request.url);
    return NextResponse.redirect(login);
  }
  return NextResponse.next();
}

export const config = {
  matcher: [
    // Everything except Next internals, static assets and favicon.
    "/((?!_next/static|_next/image|favicon\\.ico|.*\\.(?:svg|png|jpg|jpeg|webp|ico)$).*)",
  ],
};
