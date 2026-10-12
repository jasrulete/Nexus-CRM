/**
 * Completeness of the cross-tenant suite (spec §9.1).
 *
 * The suite calls every server action and page loader as workspace A with
 * workspace B's ids. Its weakness is the one every hand-kept list has: a new
 * export nobody wrote a case for. This test reads the source tree instead of
 * trusting a list. It enumerates every value export of every module with a
 * top-level "use server" directive under src/, and of every loader under
 * src/server/queries/, and requires each one to be either named by a case key
 * — the string literal "src/<module>#<export>" that a registerCrossTenantCase()
 * call in some *.test.ts file passes as its first argument — or listed in
 * CROSS_TENANT_EXEMPT as never touching the database.
 *
 * The keys are read statically because vitest isolates test files: the
 * crossTenantCases set that other files fill at run time is empty here.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CROSS_TENANT_EXEMPT } from "@/test/cross-tenant";
import {
  REPO_ROOT,
  caseKeyLiterals,
  hasUseServerDirective,
  inlineUseServerLines,
  isTestFile,
  parseSource,
  sourceFiles,
  valueExports,
} from "@/test/source-scan";

const SELF = "src/server/cross-tenant-completeness.test.ts";

const files = sourceFiles();
const productionFiles = files.filter((f) => !isTestFile(f));
const serverModules = productionFiles.filter((f) => hasUseServerDirective(parseSource(f)));
const loaders = productionFiles.filter((f) => f.startsWith("src/server/queries/"));
const covered = [...new Set([...serverModules, ...loaders])].sort();

const exportCache = new Map<string, string[] | null>();
/** A module's value exports, or null when the file does not exist. */
function exportsOf(modulePath: string): string[] | null {
  if (!exportCache.has(modulePath)) {
    exportCache.set(
      modulePath,
      existsSync(join(REPO_ROOT, modulePath)) ? valueExports(parseSource(modulePath)) : null,
    );
  }
  return exportCache.get(modulePath)!;
}

const scans = files
  .filter((f) => isTestFile(f) && f !== SELF)
  .map((f) => ({ file: f, ...caseKeyLiterals(parseSource(f)) }));
const registered = new Set(scans.flatMap((s) => s.keys));

describe("cross-tenant suite completeness", () => {
  it("finds the modules it must cover", () => {
    expect(serverModules).toEqual(
      expect.arrayContaining([
        "src/lib/auth/actions.ts",
        "src/server/actions/contacts.ts",
        "src/server/actions/deals.ts",
        "src/server/actions/search.ts",
      ]),
    );
    expect(loaders.length).toBeGreaterThan(0);
  });

  it("declares no server function inline, where this enumeration cannot see it", () => {
    const inline = productionFiles.flatMap((f) =>
      inlineUseServerLines(parseSource(f)).map((line) => `${f}:${line}`),
    );
    expect(inline, "Move inline server functions into a 'use server' module").toEqual([]);
  });

  it("can read every case key statically", () => {
    const dynamic = scans.flatMap((s) => s.dynamic.map((line) => `${s.file}:${line}`));
    expect(dynamic, "Pass registerCrossTenantCase a string literal so this test can read it").toEqual([]);
  });

  it("has a case or an exemption for every export of every 'use server' module and loader", () => {
    const missing = covered.flatMap((modulePath) =>
      (exportsOf(modulePath) ?? [])
        .filter(
          (name) =>
            !(CROSS_TENANT_EXEMPT[modulePath] ?? []).includes(name) && !registered.has(`${modulePath}#${name}`),
        )
        .map((name) => `${modulePath}#${name}`),
    );
    expect(
      missing,
      "Add a cross-tenant case (registerCrossTenantCase), or, for an export that never touches the database, a CROSS_TENANT_EXEMPT entry",
    ).toEqual([]);
  });

  it("reads a key only from registerCrossTenantCase's first argument", () => {
    const scan = (text: string) => caseKeyLiterals(parseSource("src/server/actions/example.test.ts", text));

    expect(scan('registerCrossTenantCase("src/server/actions/x.ts#a");')).toEqual({
      keys: ["src/server/actions/x.ts#a"],
      dynamic: [],
    });
    // A key-shaped literal anywhere else (a test title, a constant, a second
    // argument) registers nothing.
    expect(
      scan(
        [
          'it("covers src/server/actions/x.ts#b", () => {});',
          'const key = "src/server/actions/x.ts#c";',
          'registerCrossTenantCase("src/server/actions/x.ts#d", "src/server/actions/x.ts#e");',
        ].join("\n"),
      ),
    ).toEqual({ keys: ["src/server/actions/x.ts#d"], dynamic: [] });
  });

  it("flags a template key, and ignores templates that are not keys", () => {
    const scan = (text: string) => caseKeyLiterals(parseSource("src/server/actions/example.test.ts", text));

    expect(scan("registerCrossTenantCase(`src/server/actions/${name}.ts#a`);")).toEqual({ keys: [], dynamic: [1] });
    expect(scan("called.add(`src/server/actions/${name}.ts#${action}`);")).toEqual({ keys: [], dynamic: [] });
  });

  it("names no export that does not exist, in a case or an exemption", () => {
    const stale = [
      ...[...registered].filter((key) => {
        const [modulePath, name] = key.split("#") as [string, string];
        return !(exportsOf(modulePath) ?? []).includes(name);
      }),
      ...Object.entries(CROSS_TENANT_EXEMPT).flatMap(([modulePath, names]) =>
        names.filter((name) => !(exportsOf(modulePath) ?? []).includes(name)).map((name) => `${modulePath}#${name}`),
      ),
    ].sort();
    expect(stale).toEqual([]);
  });
});
