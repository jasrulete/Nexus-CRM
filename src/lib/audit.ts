import "server-only";
import { prisma } from "@/lib/db";

/**
 * Append an entry to the audit log. Never throws — auditing must not
 * break the action it records.
 */
export async function audit(entry: {
  action: string;
  entityType: string;
  entityId: string;
  userId?: string | null;
  metadata?: Record<string, unknown>;
}) {
  try {
    await prisma.auditLog.create({
      data: {
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId,
        userId: entry.userId ?? null,
        metadata: entry.metadata ? JSON.stringify(entry.metadata) : null,
      },
    });
  } catch (err) {
    console.error("audit log write failed", err);
  }
}
