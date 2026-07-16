"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { audit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { rateLimit, sweepExpiredBuckets } from "@/lib/rate-limit";
import { fieldErrors, loginSchema, registerSchema } from "@/lib/validation";
import { hashPassword, verifyPassword } from "./password";
import { createSession, destroySession, getCurrentUser } from "./session";

export type AuthFormState = {
  errors?: Record<string, string>;
  message?: string;
};

// Constant-time-ish guard: verify against this when the user doesn't exist
// so login duration doesn't reveal which emails are registered.
const DUMMY_HASH =
  "$2b$12$C6UzMDM.H6dfI/f/IKcEeO7ZBpUS8QSkDf0MFyzHhEBRE5l0S7y2u";

async function clientIp() {
  const fwd = (await headers()).get("x-forwarded-for");
  return fwd?.split(",")[0]?.trim() || "local";
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

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return { errors: { email: "This email is already registered" } };
  }

  const userCount = await prisma.user.count();
  const user = await prisma.user.create({
    data: {
      name,
      email,
      passwordHash: await hashPassword(password),
      // First account becomes the workspace admin.
      role: userCount === 0 ? "ADMIN" : "MEMBER",
    },
  });

  await audit({
    action: "auth.register",
    entityType: "user",
    entityId: user.id,
    userId: user.id,
  });
  await createSession(user.id);
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

  const limited = rateLimit(`login:${ip}:${email}`, {
    limit: 10,
    windowMs: 15 * 60_000,
  });
  if (!limited.ok) {
    return { message: `Too many attempts. Try again in ${limited.retryAfterSec}s.` };
  }

  const user = await prisma.user.findUnique({ where: { email } });
  const valid = await verifyPassword(password, user?.passwordHash ?? DUMMY_HASH);

  if (!user || !valid) {
    await audit({
      action: "auth.login_failed",
      entityType: "user",
      entityId: email,
      metadata: { ip },
    });
    return { message: "Invalid email or password" };
  }

  await audit({
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
    await audit({
      action: "auth.logout",
      entityType: "user",
      entityId: user.id,
      userId: user.id,
    });
  }
  await destroySession();
  redirect("/login");
}
