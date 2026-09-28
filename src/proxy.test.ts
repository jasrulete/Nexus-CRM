/**
 * The proxy's public surface, pinned.
 *
 * Social link previews for the production URL rendered without an image because
 * `/opengraph-image` fell through to the authenticated branch: a `curl` of the
 * hashed URL in the landing page's `og:image` returned `307 -> /login`
 * (2026-09-25). The route itself was fine — prerendered `○ (Static)` at build
 * time — but LinkedIn, Slack, X and Facebook scrapers are unauthenticated, so
 * the gate answered them before the image could.
 *
 * `/icon.svg` was never affected: the matcher's `.svg$` exclusion keeps the
 * proxy off it, which the live `200 image/svg+xml` confirms.
 *
 * These cases exist so a future edit to the gate cannot silently un-share the
 * URL the user puts in job applications, and cannot open a data route while
 * doing it.
 */
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { SESSION_COOKIE } from "@/lib/auth/session-constants";
import { proxy } from "./proxy";

const ORIGIN = "https://nexus-crm-jer2x.vercel.app";

function request(pathname: string, signedIn: boolean): NextRequest {
  return new NextRequest(new URL(pathname, ORIGIN), {
    headers: signedIn ? { cookie: `${SESSION_COOKIE}=any-value` } : {},
  });
}

/** The redirect's pathname, or `null` when the proxy let the request through. */
function redirectedTo(pathname: string, signedIn = false): string | null {
  const location = proxy(request(pathname, signedIn)).headers.get("location");
  return location === null ? null : new URL(location).pathname;
}

describe("proxy", () => {
  it("serves /opengraph-image to an unauthenticated scraper", () => {
    expect(redirectedTo("/opengraph-image")).toBeNull();
  });

  // Not in PUBLIC_PATHS: that branch bounces signed-in visitors to /dashboard,
  // which for an image route would serve HTML to whoever is fetching the
  // preview. Same reason /api/health and /monitoring return early.
  it("serves /opengraph-image to a signed-in visitor as well", () => {
    expect(redirectedTo("/opengraph-image", true)).toBeNull();
  });

  it.each(["/dashboard", "/contacts", "/deals", "/companies", "/settings"])(
    "still sends %s to /login without a session cookie",
    (pathname) => {
      expect(redirectedTo(pathname)).toBe("/login");
    },
  );

  it("still bounces a signed-in visitor off the marketing page", () => {
    expect(redirectedTo("/", true)).toBe("/dashboard");
  });
});
