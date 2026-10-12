/**
 * Read-only: prints PRAGMA foreign_keys (five separate reads, since each may
 * reach a different connection or stream) and the SQLite compile options,
 * through the same adapter the app uses. Phase A's step 0 runs it against
 * production before any other step (docs/runbooks/2026-10-tenancy-phase-a.md).
 * It writes nothing.
 *
 * Local:  npx tsx scripts/read-db-pragmas.ts
 * Remote: ALLOW_REMOTE_DB=true npx tsx scripts/read-db-pragmas.ts
 */
import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { createDbAdapter } from "../src/lib/db-adapter";
import { resolveResetTarget } from "../src/lib/reset-guard";

const target = resolveResetTarget();
const prisma = new PrismaClient({ adapter: createDbAdapter() });

async function main() {
  console.log(`Reading pragmas from the ${target} database (read-only).`);
  for (let i = 1; i <= 5; i++) {
    const rows = await prisma.$queryRawUnsafe<Array<{ foreign_keys: number | bigint }>>(
      "PRAGMA foreign_keys",
    );
    console.log(`foreign_keys read ${i}: ${String(rows[0]?.foreign_keys)}`);
  }
  const options = await prisma.$queryRawUnsafe<Array<{ compile_options: string }>>(
    "SELECT compile_options FROM pragma_compile_options",
  );
  console.log(`compile_options (${options.length}):`);
  for (const option of options) console.log(`  ${option.compile_options}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
