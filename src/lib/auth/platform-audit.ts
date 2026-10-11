import "server-only";
import * as Sentry from "@sentry/nextjs";
import { systemDb } from "@/lib/db";

/**
 * Platform events: sign-ups, sign-ins (good and failed) and sign-outs. They
 * belong to no workspace, so they are written with a null `workspaceId` and
 * the scoped client's injected filter keeps them out of every workspace's audit
 * card, which is how a failed login's IP never reaches a workspace (spec §5.6).
 */
export type PlatformAuditEntry = {
  action: `auth.${string}`;
  entityType: string;
  entityId: string;
  userId?: string | null;
  metadata?: Record<string, unknown>;
};

/** Best-effort, like `audit`: the event it records has already happened. */
export async function auditPlatform(entry: PlatformAuditEntry): Promise<void> {
  // The type already says so; this holds for callers that cast around it.
  if (!entry.action.startsWith("auth.")) {
    throw new TypeError(`auditPlatform records auth.* events only, got "${entry.action}"`);
  }
  try {
    await systemDb.auditLog.create({
      data: {
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId,
        userId: entry.userId ?? null,
        metadata: entry.metadata ? JSON.stringify(entry.metadata) : null,
        workspaceId: null,
      },
    });
  } catch (err) {
    Sentry.captureException(err, {
      tags: { subsystem: "audit" },
      extra: { action: entry.action, entityType: entry.entityType },
    });
    console.error("audit log write failed", err);
  }
}
