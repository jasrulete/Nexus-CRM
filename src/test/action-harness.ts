/**
 * Harness for testing the server-action layer against a real database.
 *
 * The actions are where every authorization decision lives, and until now none
 * of them had a direct test — a regression that reintroduced the missing
 * ownership check on updates would have passed CI green while the Settings page
 * told users "every mutation is authorized on the server".
 *
 * The point of this harness is that only four things are faked:
 *   - `@/lib/db`          -> a throwaway SQLite file built from the real migrations
 *   - `@/lib/auth/session` -> a settable current user, so a test can BE someone
 *   - `next/cache`         -> revalidatePath is a no-op outside a request
 *   - `next/navigation`    -> redirect throws, the way Next's own does
 *
 * Everything else — zod, canMutate, audit, the demo guard, findMissingRelation
 * — runs for real. A test that passes here exercises the actual chain.
 */
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "@/generated/prisma/client";

const MIGRATIONS_DIR = join(process.cwd(), "prisma", "migrations");

export type TestUser = { id: string; email: string; name: string; role: string };

/**
 * Builds a fresh database by replaying the committed migrations, so the schema
 * under test is the schema that ships — not one `db push` inferred from the
 * Prisma schema file.
 *
 * `through` stops after the named migration directory (inclusive). A test can
 * then insert fixtures at that older schema with raw SQL against `file`, and
 * call `applyRemaining()` to run the later migrations exactly as every runner
 * runs them (spec §9.8). The generated client only knows the current schema,
 * so use `prisma` once every migration has been applied.
 */
export function createTestDatabase(opts: { through?: string } = {}): {
  prisma: PrismaClient;
  file: string;
  applyRemaining(): void;
  destroy(): Promise<void>;
} {
  const dir = mkdtempSync(join(tmpdir(), "nexus-actions-"));
  const file = join(dir, "test.db");

  const names = readdirSync(MIGRATIONS_DIR)
    .filter((n) => statSync(join(MIGRATIONS_DIR, n)).isDirectory())
    .sort();
  let cut = names.length;
  if (opts.through !== undefined) {
    const at = names.indexOf(opts.through);
    if (at === -1) {
      throw new Error(`createTestDatabase: no migration directory named "${opts.through}"`);
    }
    cut = at + 1;
  }
  let pending = names.slice(cut);
  applyMigrations(file, names.slice(0, cut));

  const prisma = new PrismaClient({
    adapter: new PrismaBetterSqlite3({ url: `file:${file}` }),
  });

  return {
    prisma,
    file,
    applyRemaining() {
      const batch = pending;
      pending = [];
      applyMigrations(file, batch);
    },
    async destroy() {
      await prisma.$disconnect();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

function applyMigrations(file: string, names: string[]) {
  const raw = new Database(file);
  try {
    // Prisma's own migrations do not switch this on, and libSQL/Turso defaults it
    // off — but better-sqlite3 defaults it off too, so enable it explicitly here
    // rather than let onDelete rules silently not apply during a test.
    raw.pragma("foreign_keys = ON");
    for (const name of names) {
      raw.exec(readFileSync(join(MIGRATIONS_DIR, name, "migration.sql"), "utf8"));
    }
  } finally {
    // Closing also rolls back a transaction a failed migration left open.
    raw.close();
  }
}

/** Deletes every row without dropping the schema, between tests. */
export async function truncateAll(prisma: PrismaClient) {
  await prisma.activity.deleteMany();
  await prisma.task.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.deal.deleteMany();
  await prisma.contact.deleteMany();
  await prisma.company.deleteMany();
  await prisma.session.deleteMany();
  await prisma.user.deleteMany();
}

export async function makeUser(
  prisma: PrismaClient,
  overrides: Partial<TestUser> & { email: string },
): Promise<TestUser> {
  const user = await prisma.user.create({
    data: {
      email: overrides.email,
      name: overrides.name ?? overrides.email.split("@")[0],
      role: overrides.role ?? "MEMBER",
      // Never verified in these tests; the auth actions have their own suite.
      passwordHash: "not-a-real-hash",
    },
  });
  return { id: user.id, email: user.email, name: user.name, role: user.role };
}

/** Builds a FormData the way a real `<form>` submission would. */
export function formData(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  return fd;
}

/**
 * Same, plus the optimistic-concurrency version the edit forms carry.
 *
 * The update actions refuse a submit with no version rather than falling back
 * to last-write-wins, so a test exercising the *allowed* path has to send one —
 * exactly as the real form does.
 */
export function formDataFor(
  record: { updatedAt: Date },
  fields: Record<string, string>,
): FormData {
  return formData({ ...fields, updatedAt: record.updatedAt.toISOString() });
}
