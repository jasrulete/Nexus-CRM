import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth/session-constants";

// "/" is the marketing page; signed-in visitors get bounced to /dashboard
// below, which is what the old redirect in app/page.tsx used to do.
const PUBLIC_PATHS = new Set(["/", "/login", "/register"]);

/**
 * Optimistic auth gate: checks only cookie *presence* for fast redirects.
 * Real session validation happens server-side in layouts and actions
 * (getCurrentUser), so a forged cookie never grants access to data.
 */
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // The liveness probe must answer monitors whether signed in or not.
  if (pathname === "/api/health") return NextResponse.next();

  // Sentry's browser tunnel (tunnelRoute in next.config.ts). It carries error
  // reports for signed-in and signed-out visitors alike, so it cannot go in
  // PUBLIC_PATHS — that branch redirects authenticated users to /dashboard.
  if (pathname === "/monitoring") return NextResponse.next();

  // The Open Graph image behind the landing page's og:image/twitter:image.
  // Social scrapers are never signed in, so gating it left every shared link
  // without a preview; it cannot go in PUBLIC_PATHS either, for the same reason
  // as /monitoring — a signed-in fetch would get /dashboard's HTML instead of
  // the PNG. /icon.svg needs no entry: the matcher's .svg exclusion covers it.
  if (pathname === "/opengraph-image") return NextResponse.next();

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
    // theme-init.js is listed explicitly: it is a public asset, and redirecting
    // it to /login left signed-out visitors stuck in light mode.
    "/((?!_next/static|_next/image|favicon\\.ico|theme-init\\.js|.*\\.(?:svg|png|jpg|jpeg|webp|ico)$).*)",
  ],
};
