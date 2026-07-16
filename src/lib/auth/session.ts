import "server-only";
import { createHash, randomBytes } from "crypto";
import { cookies, headers } from "next/headers";
import { cache } from "react";
import { prisma } from "@/lib/db";
import { SESSION_COOKIE } from "./session-constants";

export { SESSION_COOKIE };

const SESSION_DAYS = 30;
/** Sliding expiry: renew when less than this many days remain. */
const RENEW_BELOW_DAYS = 15;

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function cookieOptions(expires: Date) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires,
  };
}

/** Create a DB session and set the cookie. Only the SHA-256 of the token is stored. */
export async function createSession(userId: string) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86400_000);
  const userAgent = (await headers()).get("user-agent")?.slice(0, 255) ?? null;

  await prisma.session.create({
    data: { tokenHash: hashToken(token), userId, expiresAt, userAgent },
  });
  (await cookies()).set(SESSION_COOKIE, token, cookieOptions(expiresAt));
}

export async function destroySession() {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) {
    await prisma.session
      .delete({ where: { tokenHash: hashToken(token) } })
      .catch(() => {});
  }
  store.delete(SESSION_COOKIE);
}

/**
 * Validate the session cookie against the database.
 * Cached per request so layouts, pages and actions can all call it cheaply.
 */
export const getCurrentUser = cache(async () => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const session = await prisma.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: true },
  });
  if (!session) return null;

  if (session.expiresAt < new Date()) {
    await prisma.session.delete({ where: { id: session.id } }).catch(() => {});
    return null;
  }

  // Sliding renewal — extend long-lived sessions that are still in use.
  const remaining = session.expiresAt.getTime() - Date.now();
  if (remaining < RENEW_BELOW_DAYS * 86400_000) {
    const expiresAt = new Date(Date.now() + SESSION_DAYS * 86400_000);
    await prisma.session
      .update({ where: { id: session.id }, data: { expiresAt } })
      .catch(() => {});
  }

  const { passwordHash, ...safeUser } = session.user;
  void passwordHash; // stripped so it can never leak to the client
  return safeUser;
});

/** For server actions/pages that must be authenticated. Throws if not. */
export async function requireUser() {
  const user = await getCurrentUser();
  if (!user) throw new Error("UNAUTHORIZED");
  return user;
}
