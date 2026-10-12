/**
 * Under Next 16 partial rendering, the (app) layout neither re-runs on
 * navigation nor stops a page from rendering (spec §5.3). So every page
 * resolves the workspace itself and reads only through its loader. This reads
 * the page sources, because a page that went back to importing the database
 * client, or that leaned on the layout for its session, would still type-check.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

const APP = join(process.cwd(), "src", "app", "(app)");

function pages(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return pages(path);
    return name === "page.tsx" ? [path] : [];
  });
}

const files = pages(APP).map((file) => ({
  name: relative(APP, file).split(sep).join("/"),
  source: readFileSync(file, "utf8"),
}));

describe("(app) pages", () => {
  it("are the eight this guard was written for", () => {
    expect(files.map((f) => f.name).sort()).toEqual([
      "companies/[id]/page.tsx",
      "companies/page.tsx",
      "contacts/[id]/page.tsx",
      "contacts/page.tsx",
      "dashboard/page.tsx",
      "deals/[id]/page.tsx",
      "deals/page.tsx",
      "settings/page.tsx",
    ]);
  });

  it.each(files.map((f) => [f.name, f.source] as const))(
    "%s resolves the workspace itself and reads only through a loader",
    (_name, source) => {
      expect(source).toContain("await requireWorkspacePage()");
      expect(source).toContain('from "@/server/queries/');
      expect(source).not.toContain('from "@/lib/db"');
      expect(source).not.toContain("getCurrentUser");
      expect(source).not.toMatch(/\.(findMany|findUnique|findFirst|count|aggregate|groupBy)\(/);
    },
  );
});

describe("the (app) layout and the user menu", () => {
  const layout = readFileSync(join(APP, "layout.tsx"), "utf8");
  const menu = readFileSync(join(process.cwd(), "src", "components", "user-menu.tsx"), "utf8");

  it("resolve the role on the server and pass display fields only", () => {
    expect(layout).toContain("await requireWorkspacePage()");
    expect(layout).toContain("isAdmin: isWorkspaceAdmin(ctx.role)");
    expect(layout).not.toContain("user={user}");
    expect(layout).not.toContain("getCurrentUser");
    expect(menu).toContain("user.isAdmin");
    expect(menu).not.toContain('=== "ADMIN"');
  });
});
