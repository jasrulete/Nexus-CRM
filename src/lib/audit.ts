import "server-only";
import * as Sentry from "@sentry/nextjs";
import { prisma } from "@/lib/db";

/**
 * Anything that can write a workspace audit row: a scoped client
 * (`ctx.db`), or the `tx` handed to its `$transaction` callback. Structural
 * rather than imported, so this file does not depend on Prisma's internal
 * transaction types.
 */
export type AuditWriter = {
  auditLog: {
    create(args: {
      data: {
        action: string;
        entityType: string;
        entityId: string;
        userId: string | null;
        metadata: string | null;
        workspaceId: string;
      };
    }): Promise<unknown>;
  };
};

export type WorkspaceAuditEntry = {
  action: string;
  entityType: string;
  entityId: string;
  workspaceId: string;
  userId?: string | null;
  metadata?: Record<string, unknown>;
};

function row(entry: WorkspaceAuditEntry) {
  return {
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId,
    userId: entry.userId ?? null,
    metadata: entry.metadata ? JSON.stringify(entry.metadata) : null,
    workspaceId: entry.workspaceId,
  };
}

function report(err: unknown, entry: { action: string; entityType: string }) {
  Sentry.captureException(err, {
    tags: { subsystem: "audit" },
    extra: { action: entry.action, entityType: entry.entityType },
  });
  console.error("audit log write failed", err);
}

/**
 * Writes the entry inside the caller's transaction, and a failure propagates —
 * rolling the mutation back with it. That is the right trade for a state
 * change: the Settings page presents this log as the record of what happened,
 * so a committed change with no entry makes the log lie. Better to fail the
 * save and let the user retry.
 *
 * Pass the callback's `tx`, never the outer client (spec §5.2): on the
 * production driver a query outside the open transaction waits for it until
 * the transaction times out.
 */
export async function auditTx(tx: AuditWriter, entry: WorkspaceAuditEntry): Promise<void> {
  await tx.auditLog.create({ data: row(entry) });
}

// ---- Transitional: the pre-workspace call form, removed in Task 19. ----

/** @deprecated The pre-workspace entry shape. Removed in Task 19. */
export type AuditEntry = {
  action: string;
  entityType: string;
  entityId: string;
  userId?: string | null;
  metadata?: Record<string, unknown>;
};

type LegacyAuditWriter = {
  auditLog: {
    create(args: {
      data: {
        action: string;
        entityType: string;
        entityId: string;
        userId: string | null;
        metadata: string | null;
      };
    }): Promise<unknown>;
  };
};

function isWriter(value: unknown): value is AuditWriter {
  return typeof value === "object" && value !== null && "auditLog" in value;
}

/**
 * Appends a workspace entry after the fact, best-effort: it never throws,
 * because the action it records has already committed and breaking it now
 * helps nobody. A failure goes to Sentry as well as the console, since
 * `onRequestError` never sees a swallowed error and a gap in the log would
 * otherwise be invisible.
 *
 * `db` is required (the scoped client): there is no module-level fallback, so
 * every entry lands in the caller's workspace. Platform events (`auth.*`) go
 * through `auditPlatform` instead.
 */
export async function audit(db: AuditWriter, entry: WorkspaceAuditEntry): Promise<void>;
/**
 * @deprecated The pre-workspace form: writes with no workspace. Kept only so
 * the server actions compile until Tasks 11–16 move them to `audit(db, entry)`
 * and `auditTx(tx, entry)`. Removed in Task 19.
 */
export async function audit(entry: AuditEntry, tx?: LegacyAuditWriter): Promise<void>;
export async function audit(
  first: AuditWriter | AuditEntry,
  second?: WorkspaceAuditEntry | LegacyAuditWriter,
): Promise<void> {
  if (isWriter(first)) {
    const entry = second as WorkspaceAuditEntry;
    try {
      await first.auditLog.create({ data: row(entry) });
    } catch (err) {
      report(err, entry);
    }
    return;
  }

  const entry = first;
  const data = {
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId,
    userId: entry.userId ?? null,
    metadata: entry.metadata ? JSON.stringify(entry.metadata) : null,
  };
  const tx = second as LegacyAuditWriter | undefined;
  if (tx) {
    await tx.auditLog.create({ data });
    return;
  }
  try {
    await prisma.auditLog.create({ data });
  } catch (err) {
    report(err, entry);
  }
}
