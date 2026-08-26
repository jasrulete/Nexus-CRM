import "server-only";
import * as Sentry from "@sentry/nextjs";
import { prisma } from "@/lib/db";

/**
 * Anything that can write an audit row — the Prisma client, or a transaction
 * client handed to a `$transaction` callback. Structural rather than imported,
 * so this file does not depend on Prisma's internal transaction types.
 */
type AuditWriter = {
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

export type AuditEntry = {
  action: string;
  entityType: string;
  entityId: string;
  userId?: string | null;
  metadata?: Record<string, unknown>;
};

function write(client: AuditWriter, entry: AuditEntry) {
  return client.auditLog.create({
    data: {
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      userId: entry.userId ?? null,
      metadata: entry.metadata ? JSON.stringify(entry.metadata) : null,
    },
  });
}

/**
 * Append an entry to the audit log.
 *
 * Two modes, chosen by whether the caller passes its transaction client.
 *
 * **With a transaction client** the entry is written inside the caller's
 * transaction, and a failure propagates — rolling the mutation back with it.
 * That is the right trade for a state change: the Settings page presents this
 * log as the record of what happened, so a committed change with no entry makes
 * the log lie. Better to fail the save and let the user retry.
 *
 * **Without one** it stays best-effort and never throws, because the action it
 * records has already committed and breaking it after the fact helps nobody.
 * That path now reports to Sentry as well as the console: it previously
 * swallowed failures into `console.error`, which `onRequestError` never sees, so
 * a gap in the log was invisible — and absence of an entry proved nothing.
 */
export async function audit(entry: AuditEntry, tx?: AuditWriter) {
  if (tx) {
    await write(tx, entry);
    return;
  }

  try {
    await write(prisma, entry);
  } catch (err) {
    Sentry.captureException(err, {
      tags: { subsystem: "audit" },
      extra: { action: entry.action, entityType: entry.entityType },
    });
    console.error("audit log write failed", err);
  }
}
