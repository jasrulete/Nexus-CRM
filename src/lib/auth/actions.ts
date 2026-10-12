"use server";

import { randomBytes } from "crypto";
import * as Sentry from "@sentry/nextjs";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import type { Prisma } from "@/generated/prisma/client";
import { systemDb } from "@/lib/db";
import { peekLimit, rateLimit, sweepExpiredBuckets } from "@/lib/rate-limit";
import { fieldErrors, loginSchema, registerSchema } from "@/lib/validation";
import { ensureMember, ensureSingleWorkspace, memberCount } from "@/lib/workspace-bootstrap";
import { workspaceMode } from "@/lib/workspace-mode";
import { hashPassword, verifyPassword } from "./password";
import { auditPlatform } from "./platform-audit";
import { createSession, destroySession, getCurrentUser } from "./session";

export type AuthFormState = {
  errors?: Record<string, string>;
  message?: string;
};

// Constant-time-ish guard: verify against this when the user doesn't exist
// so login duration doesn't reveal which emails are registered.
const DUMMY_HASH =
  "$2b$12$C6UzMDM.H6dfI/f/IKcEeO7ZBpUS8QSkDf0MFyzHhEBRE5l0S7y2u";

// Login limits, all per 15 minutes. The per-source cap counts every attempt,
// successes included: it bounds the bcrypt work one address can force and
// stops one address spraying one guess across many accounts. The other two
// count failures only, so a shared account (the demo) cannot be locked by
// its own visitors: one per source and email, one per account.
const LOGIN_WINDOW_MS = 15 * 60_000;
const IP_ATTEMPT_LIMIT = 100;
const PAIR_FAILURE_LIMIT = 10;
const ACCOUNT_FAILURE_LIMIT = 20;

// Only platform-set headers are trustworthy; a direct client can send any
// x-forwarded-for it likes, so that one is a last-resort dev/self-host fallback.
async function clientIp() {
  const h = await headers();
  const trusted = h.get("x-vercel-forwarded-for") ?? h.get("x-real-ip");
  if (trusted) return trusted.trim();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
}

const EMAIL_TAKEN = "This email is already registered";
const SIGNUP_FAILED = "Sign-up could not complete. Please try again.";

type NewAccount = { name: string; email: string; passwordHash: string };

/**
 * Single mode: join the one workspace. The first member becomes OWNER and
 * everyone after is MEMBER. The count runs inside the transaction, so two
 * first sign-ups racing cannot both see an empty workspace.
 *
 * The user is created first, so a refusal from the workspace checks (more than
 * one workspace, a PAID one, or a lone one single mode did not create) rolls
 * the whole sign-up back.
 */
async function joinSingleWorkspace(tx: Prisma.TransactionClient, account: NewAccount): Promise<string> {
  const user = await tx.user.create({ data: account, select: { id: true } });
  const { id: workspaceId } = await ensureSingleWorkspace(tx);
  const role = (await memberCount(tx, workspaceId)) === 0 ? "OWNER" : "MEMBER";
  await ensureMember(tx, user.id, role);
  return user.id;
}

/** Multi mode: a private workspace, owned by the new user. Never an existing one. */
async function createOwnWorkspace(tx: Prisma.TransactionClient, account: NewAccount): Promise<string> {
  const workspace = await tx.workspace.create({
    data: { name: `${account.name}'s workspace`, slug: workspaceSlug(account.name) },
    select: { id: true },
  });
  const user = await tx.user.create({ data: account, select: { id: true } });
  await tx.membership.create({ data: { workspaceId: workspace.id, userId: user.id, role: "OWNER" } });
  return user.id;
}

/** "Ada Lovelace" -> "ada-lovelace-3f9a1c2e". The suffix keeps two Adas apart. */
function workspaceSlug(name: string): string {
  const base = name
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/, "");
  return `${base || "workspace"}-${randomBytes(4).toString("hex")}`;
}

export async function register(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  sweepExpiredBuckets();
  const ip = await clientIp();
  const limited = rateLimit(`register:${ip}`, { limit: 5, windowMs: 15 * 60_000 });
  if (!limited.ok) {
    return { message: `Too many attempts. Try again in ${limited.retryAfterSec}s.` };
  }

  const parsed = registerSchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };

  const { name, email, password } = parsed.data;

  const existing = await systemDb.user.findUnique({ where: { email }, select: { id: true } });
  if (existing) {
    return { errors: { email: EMAIL_TAKEN } };
  }

  // Before the transaction: bcrypt is slow on purpose, and on the production
  // driver an open transaction holds an adapter-wide lock (spec §5.2).
  const account = { name, email, passwordHash: await hashPassword(password) };
  const mode = workspaceMode();

  let userId: string;
  try {
    userId = await systemDb.$transaction((tx) =>
      mode === "multi" ? createOwnWorkspace(tx, account) : joinSingleWorkspace(tx, account),
    );
  } catch (err) {
    // Two sign-ups with one email can both pass the check above. The second
    // transaction then fails on the unique email and rolls back whole. Hrana
    // reports that as a generic P2039, so look again instead of reading the
    // error code (spec §5.6). If the lookup fails too, fall through to the
    // retry message: a retry's pre-check gives the right answer.
    const taken = await systemDb.user
      .findUnique({ where: { email }, select: { id: true } })
      .catch(() => null);
    if (taken) return { errors: { email: EMAIL_TAKEN } };
    // A database that is not a valid single-mode one is an operator error.
    // It fails loudly, the way boot does, instead of asking for a retry.
    if (err instanceof Error && err.message.startsWith("SINGLE_MODE_VIOLATION")) throw err;
    // Anything else is transient from the visitor's side: SQLITE_BUSY when two
    // serverless instances write to Turso at once, or a dropped connection.
    // The transaction rolled back, so nothing was written and a retry is safe.
    Sentry.captureException(err, {
      tags: { subsystem: "auth" },
      extra: { action: "auth.register", mode },
    });
    console.error("sign-up transaction failed", err);
    return { message: SIGNUP_FAILED };
  }

  // After commit, outside the transaction (spec §5.2).
  await auditPlatform({
    action: "auth.register",
    entityType: "user",
    entityId: userId,
    userId,
  });
  await createSession(userId);
  redirect("/dashboard");
}

export async function login(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  sweepExpiredBuckets();
  const ip = await clientIp();

  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };

  const { email, password } = parsed.data;

  // Charged on every attempt, before the lookup and the bcrypt compare, so a
  // refused request costs nothing. A hundred per window bounds what one
  // address can make the server do — a stream of fresh emails, or the
  // published demo credentials, used to be a free CPU faucet — while staying
  // far above real use: the end-to-end suite alone signs in 36 times from one
  // address per run. Like every bucket here it is per instance on serverless.
  const sourceLimited = rateLimit(`login:ip:${ip}`, {
    limit: IP_ATTEMPT_LIMIT,
    windowMs: LOGIN_WINDOW_MS,
  });
  if (!sourceLimited.ok) {
    return { message: `Too many attempts. Try again in ${sourceLimited.retryAfterSec}s.` };
  }

  // These two count *failed* attempts only — a successful sign-in is not
  // abuse, and charging it would let the shared demo account lock out its own
  // visitors. The pair bucket stops one source guessing one account; the
  // account bucket survives forwarded-for spoofing, which the source ones
  // cannot (a spoofed flood of fresh keys cannot evict it either: the map
  // evicts unexhausted buckets before a lockout).
  const pairKey = `login:${ip}:${email}`;
  const accountKey = `login:account:${email}`;

  const limited = peekLimit(pairKey, { limit: PAIR_FAILURE_LIMIT });
  if (!limited.ok) {
    return { message: `Too many attempts. Try again in ${limited.retryAfterSec}s.` };
  }

  const accountLimited = peekLimit(accountKey, { limit: ACCOUNT_FAILURE_LIMIT });
  if (!accountLimited.ok) {
    return {
      message: `Too many attempts. Try again in ${accountLimited.retryAfterSec}s.`,
    };
  }

  const user = await systemDb.user.findUnique({ where: { email } });
  const valid = await verifyPassword(password, user?.passwordHash ?? DUMMY_HASH);

  if (!user || !valid) {
    rateLimit(pairKey, { limit: PAIR_FAILURE_LIMIT, windowMs: LOGIN_WINDOW_MS });
    rateLimit(accountKey, { limit: ACCOUNT_FAILURE_LIMIT, windowMs: LOGIN_WINDOW_MS });
    await auditPlatform({
      action: "auth.login_failed",
      entityType: "user",
      entityId: email,
      metadata: { ip },
    });
    return { message: "Invalid email or password" };
  }

  await auditPlatform({
    action: "auth.login",
    entityType: "user",
    entityId: user.id,
    userId: user.id,
  });
  await createSession(user.id);
  redirect("/dashboard");
}

export async function logout() {
  const user = await getCurrentUser();
  if (user) {
    await auditPlatform({
      action: "auth.logout",
      entityType: "user",
      entityId: user.id,
      userId: user.id,
    });
  }
  await destroySession();
  redirect("/login");
}
