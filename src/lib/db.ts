import { PrismaClient } from "@/generated/prisma/client";
import { createDbAdapter } from "./db-adapter";
import { scopeToWorkspace, type ScopedDb } from "./tenancy";
import { bootCheckSingleModeDatabase } from "./workspace-bootstrap";

export { scopeToWorkspace } from "./tenancy";
export type { ScopedDb } from "./tenancy";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

/**
 * The unscoped base client. Application code never imports it: it gets a
 * scoped client from requireWorkspace() / requireWorkspacePage() instead.
 * Only the files on the spec §5.1 allowlist may import this, and a test
 * enforces that list.
 */
// Singleton so hot reload in dev doesn't exhaust connections.
export const systemDb: PrismaClient =
  globalForPrisma.prisma ?? new PrismaClient({ adapter: createDbAdapter() });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = systemDb;

/** A client that can only see and write one workspace's rows (spec §5.1). */
export function forWorkspace(workspaceId: string): ScopedDb {
  return scopeToWorkspace(systemDb, workspaceId);
}

/** @deprecated Removed in Task 19. Use forWorkspace / systemDb. */
export const prisma: PrismaClient = systemDb;

/**
 * The boot-time half of single mode's guard (spec §6), run by
 * instrumentation's register(). It lives here so the boot path reaches the
 * base client without a file outside the systemDb allowlist importing it.
 * Which failures stop the boot is decided by bootCheckSingleModeDatabase.
 */
export async function assertSingleModeBoot(): Promise<void> {
  await bootCheckSingleModeDatabase(systemDb);
}
