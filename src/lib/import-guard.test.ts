/**
 * Where the unscoped client may be reached (spec §5.1, §9.3).
 *
 * Application code gets a database handle only as the scoped `ctx.db`. The
 * unscoped `systemDb` may be imported only by the exact allowlist below;
 * `forWorkspace`, which returns a working client for whatever id it is given,
 * only by src/lib/workspace-context.ts (and db.ts, which defines it); and
 * only src/lib/db.ts and the test harness may take PrismaClient as a value or
 * construct one. Test files are not scanned (they mock src/lib/db), and
 * neither are scripts/ and prisma/, which build their own clients outside the
 * app (spec §8).
 *
 * The scan parses each file with the TypeScript parser, so a comment or a
 * string that mentions systemDb is not an import, and every import form is:
 * named, aliased, namespace, re-export, and dynamic import().
 */
import ts from "typescript";
import { describe, expect, it } from "vitest";
import {
  clientConstructions,
  isTestFile,
  lineOf,
  moduleRefs,
  parseSource,
  resolveModule,
  sourceFiles,
  valueExports,
} from "@/test/source-scan";

/** The contract's allowlist: the only files that may import systemDb. */
const SYSTEM_DB_ALLOWLIST = new Set([
  "src/lib/db.ts",
  "src/lib/auth/session.ts",
  "src/lib/auth/actions.ts",
  "src/lib/auth/platform-audit.ts",
  "src/lib/workspace-context.ts",
  "src/lib/workspace-bootstrap.ts",
  "src/lib/system-queries.ts",
  "src/app/api/health/route.ts",
  "src/app/auth/signout-stale/route.ts",
]);

/**
 * The only files that may import forWorkspace. It scopes to any id it is
 * given, so the id must come from the caller's own membership, which only the
 * workspace context resolves.
 */
const FOR_WORKSPACE_ALLOWLIST = new Set(["src/lib/db.ts", "src/lib/workspace-context.ts"]);

/** Each guarded export of src/lib/db, with the files that may import it. */
const DB_EXPORT_ALLOWLISTS: ReadonlyArray<readonly [string, ReadonlySet<string>]> = [
  ["systemDb", SYSTEM_DB_ALLOWLIST],
  ["forWorkspace", FOR_WORKSPACE_ALLOWLIST],
];

/** The only files that may take PrismaClient as a value, or construct one. */
const CLIENT_OWNERS = new Set(["src/lib/db.ts", "src/test/action-harness.ts"]);

const GENERATED_CLIENT = /^src\/generated\/prisma(\/|$)/;

function violations(rel: string, text?: string): string[] {
  const sf = parseSource(rel, text);
  const found: string[] = [];
  for (const ref of moduleRefs(sf)) {
    if (ref.module === "src/lib/db") {
      const reached = DB_EXPORT_ALLOWLISTS.filter(
        ([name, allowlist]) => !allowlist.has(rel) && (ref.wholeModule || ref.names.includes(name)),
      ).map(([name]) => name);
      if (reached.length > 0) found.push(`${rel}:${ref.line} reaches ${reached.join(" and ")} in src/lib/db`);
    }
    const clientModule = GENERATED_CLIENT.test(ref.module) || ref.module === "@prisma/client";
    if (clientModule && !CLIENT_OWNERS.has(rel) && ref.names.includes("PrismaClient")) {
      found.push(`${rel}:${ref.line} imports PrismaClient as a value (use \`import type\`)`);
    }
  }
  if (!CLIENT_OWNERS.has(rel)) {
    for (const line of clientConstructions(sf)) found.push(`${rel}:${line} constructs a PrismaClient`);
  }
  return found;
}

/** `prisma` keys left in a test's vi.mock("@/lib/db", factory). */
function dbMocksWithPrismaKey(rel: string): string[] {
  const sf = parseSource(rel);
  const found: string[] = [];
  const visit = (node: ts.Node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === "vi" &&
      node.expression.name.text === "mock"
    ) {
      const [target, factory] = node.arguments;
      if (target && factory && ts.isStringLiteralLike(target) && resolveModule(rel, target.text) === "src/lib/db") {
        const scan = (n: ts.Node) => {
          if (
            (ts.isShorthandPropertyAssignment(n) || ts.isPropertyAssignment(n)) &&
            ts.isIdentifier(n.name) &&
            n.name.text === "prisma"
          ) {
            found.push(`${rel}:${lineOf(sf, n)}`);
          }
          ts.forEachChild(n, scan);
        };
        scan(factory);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

describe("the import guard's own detection", () => {
  const ACTION = "src/server/actions/example.ts";

  it.each([
    ['import { systemDb } from "@/lib/db";'],
    ['import { systemDb as db } from "../../lib/db";'],
    ['import * as db from "@/lib/db";'],
    ['export { systemDb } from "@/lib/db";'],
    ['export * from "@/lib/db";'],
    // Not destructured: every export of the module is reachable.
    ['const db = await import("@/lib/db");'],
  ])("flags %s outside the allowlist", (source) => {
    expect(violations(ACTION, source)).toHaveLength(1);
  });

  // A dynamic import destructured on the spot takes exactly the names it lists.
  // That is how src/instrumentation.ts reaches the boot check without being on
  // the systemDb allowlist.
  it("flags a destructured dynamic import that takes systemDb", () => {
    expect(violations(ACTION, 'const { systemDb } = await import("@/lib/db");')).toHaveLength(1);
  });

  it("allows a destructured dynamic import that takes only assertSingleModeBoot", () => {
    expect(violations(ACTION, 'const { assertSingleModeBoot } = await import("@/lib/db");')).toEqual([]);
  });

  // forWorkspace returns a working client for whatever id it is given, so only
  // the workspace context may call it, with the caller's own membership.
  it.each([
    ['import { forWorkspace } from "@/lib/db";'],
    ['import { forWorkspace as scoped } from "../../lib/db";'],
    ['export { forWorkspace } from "@/lib/db";'],
    ['const { forWorkspace } = await import("@/lib/db");'],
  ])("flags %s outside the workspace context", (source) => {
    expect(violations(ACTION, source)).toEqual([`${ACTION}:1 reaches forWorkspace in src/lib/db`]);
  });

  it("allows forWorkspace in src/lib/workspace-context.ts, not in another systemDb-allowlisted file", () => {
    expect(violations("src/lib/workspace-context.ts", 'import { forWorkspace, systemDb } from "@/lib/db";')).toEqual([]);
    expect(violations("src/lib/system-queries.ts", 'import { forWorkspace, systemDb } from "@/lib/db";')).toEqual([
      "src/lib/system-queries.ts:1 reaches forWorkspace in src/lib/db",
    ]);
  });

  it.each([
    ['import type { ScopedDb } from "@/lib/tenancy";'],
    ['// import { systemDb } from "@/lib/db";'],
    ["const note = 'import { systemDb } from \"@/lib/db\"';"],
    ['import type { PrismaClient } from "@/generated/prisma/client";'],
    ['import { type PrismaClient, Prisma } from "@/generated/prisma/client";'],
  ])("allows %s", (source) => {
    expect(violations(ACTION, source)).toEqual([]);
  });

  it("allows systemDb in an allowlisted file", () => {
    expect(violations("src/lib/system-queries.ts", 'import { systemDb } from "@/lib/db";')).toEqual([]);
  });

  it.each([
    ['import { PrismaClient } from "@/generated/prisma/client";'],
    ['import { PrismaClient } from "../../generated/prisma/client";'],
    ['import type { PrismaClient } from "@/generated/prisma/client";\nconst client = new PrismaClient();'],
  ])("flags a PrismaClient value or construction: %s", (source) => {
    expect(violations(ACTION, source)).toHaveLength(1);
  });

  it("allows the client in src/lib/db.ts", () => {
    expect(
      violations(
        "src/lib/db.ts",
        'import { PrismaClient } from "@/generated/prisma/client";\nexport const systemDb = new PrismaClient();',
      ),
    ).toEqual([]);
  });
});

describe("the source tree", () => {
  it("takes systemDb, forWorkspace or a PrismaClient value only where the allowlists say", () => {
    const files = sourceFiles().filter((f) => !isTestFile(f));
    // The walk really reached the tree.
    expect(files).toEqual(expect.arrayContaining(["src/lib/db.ts", "src/server/actions/contacts.ts"]));
    expect(files.flatMap((f) => violations(f))).toEqual([]);
  });
});

describe("the deprecated prisma alias is gone", () => {
  it("src/lib/db.ts exports systemDb, forWorkspace and scopeToWorkspace, and no prisma", () => {
    const exported = valueExports(parseSource("src/lib/db.ts"));
    expect(exported).toEqual(expect.arrayContaining(["forWorkspace", "scopeToWorkspace", "systemDb"]));
    expect(exported).not.toContain("prisma");
  });

  it("nothing under src/ imports prisma from src/lib/db", () => {
    const offenders = sourceFiles().flatMap((rel) =>
      moduleRefs(parseSource(rel))
        .filter((ref) => ref.module === "src/lib/db" && ref.names.includes("prisma"))
        .map((ref) => `${rel}:${ref.line}`),
    );
    expect(offenders).toEqual([]);
  });

  it("no test mocks src/lib/db with a prisma key", () => {
    expect(sourceFiles().filter(isTestFile).flatMap(dbMocksWithPrismaKey)).toEqual([]);
  });
});
