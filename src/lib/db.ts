import { PrismaClient } from "@/generated/prisma/client";
import { createDbAdapter } from "./db-adapter";
import { bootCheckSingleModeDatabase } from "./workspace-bootstrap";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

// Singleton so hot reload in dev doesn't exhaust connections.
export const prisma =
  globalForPrisma.prisma ?? new PrismaClient({ adapter: createDbAdapter() });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

/**
 * The boot-time half of single mode's guard (spec §6), run by
 * instrumentation's register(). It lives here so the boot path reaches the
 * base client without a file outside the systemDb allowlist importing it.
 * Which failures stop the boot is decided by bootCheckSingleModeDatabase.
 */
export async function assertSingleModeBoot(): Promise<void> {
  await bootCheckSingleModeDatabase(prisma);
}
