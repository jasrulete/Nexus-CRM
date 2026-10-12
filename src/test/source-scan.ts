/**
 * Static checks over the source tree, shared by the import guard
 * (src/lib/import-guard.test.ts) and the cross-tenant completeness test
 * (src/server/cross-tenant-completeness.test.ts).
 *
 * Built on the TypeScript parser rather than regular expressions, so a comment
 * or a string literal never counts as an import, and every import form is
 * seen. Paths are repo-relative with forward slashes ("src/lib/db.ts").
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import ts from "typescript";
import { CASE_KEY } from "./cross-tenant";

export const REPO_ROOT = process.cwd();

export function toRepoPath(absolute: string): string {
  return relative(REPO_ROOT, absolute).split(sep).join("/");
}

/** Every .ts and .tsx file under src/, sorted. The generated client is skipped. */
export function sourceFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const absolute = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (toRepoPath(absolute) !== "src/generated") walk(absolute);
      } else if (/\.tsx?$/.test(entry.name) && !entry.name.endsWith(".d.ts")) {
        out.push(toRepoPath(absolute));
      }
    }
  };
  walk(join(REPO_ROOT, "src"));
  return out.sort();
}

export function isTestFile(rel: string): boolean {
  return /\.test\.tsx?$/.test(rel);
}

/** Parses a file by repo-relative path; `text` replaces its contents (for tests of the scanner). */
export function parseSource(rel: string, text?: string): ts.SourceFile {
  const source = text ?? readFileSync(join(REPO_ROOT, rel), "utf8");
  return ts.createSourceFile(
    rel,
    source,
    ts.ScriptTarget.Latest,
    true,
    rel.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
}

export function lineOf(sf: ts.SourceFile, node: ts.Node): number {
  return sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
}

/**
 * "@/lib/db" or "../lib/db" (from the importing file) → "src/lib/db", with no
 * extension and no trailing /index. A bare package specifier comes back as-is.
 */
export function resolveModule(fromRel: string, specifier: string): string {
  let absolute: string;
  if (specifier.startsWith("@/")) absolute = join(REPO_ROOT, "src", specifier.slice(2));
  else if (specifier.startsWith(".")) absolute = resolve(REPO_ROOT, dirname(fromRel), specifier);
  else return specifier;
  return toRepoPath(absolute)
    .replace(/\.(tsx?|mjs|js)$/, "")
    .replace(/\/index$/, "");
}

export type ModuleRef = {
  /** The resolved module, e.g. "src/lib/db", or a package name. */
  module: string;
  line: number;
  /**
   * Bindings taken by name as values; "default" for a default import. Type-only
   * bindings are left out. For `const { a, b: c } = await import("…")`: "a", "b".
   */
  names: string[];
  /**
   * A namespace import, `export *`, or a dynamic import() whose result is not
   * destructured on the spot: every export is reachable.
   */
  wholeModule: boolean;
};

/**
 * The export names taken by `const { a, b: c } = await import("…")`, when this
 * import() call is the awaited initializer of an object binding pattern.
 * Anything else — no destructuring, a rest element, a computed key — is null:
 * the whole module is reachable.
 */
function destructuredImportNames(call: ts.CallExpression): string[] | null {
  const awaited = call.parent;
  if (!awaited || !ts.isAwaitExpression(awaited)) return null;
  const declaration = awaited.parent;
  if (
    !declaration ||
    !ts.isVariableDeclaration(declaration) ||
    declaration.initializer !== awaited ||
    !ts.isObjectBindingPattern(declaration.name)
  ) {
    return null;
  }
  const names: string[] = [];
  for (const element of declaration.name.elements) {
    if (element.dotDotDotToken) return null;
    const key = element.propertyName ?? element.name;
    if (ts.isIdentifier(key) || ts.isStringLiteral(key)) names.push(key.text);
    else return null;
  }
  return names;
}

/** Every value-level reference this file makes to another module. */
export function moduleRefs(sf: ts.SourceFile): ModuleRef[] {
  const rel = sf.fileName;
  const refs: ModuleRef[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const clause = node.importClause;
      if (clause && !clause.isTypeOnly) {
        const names: string[] = [];
        let wholeModule = false;
        if (clause.name) names.push("default");
        const bindings = clause.namedBindings;
        if (bindings && ts.isNamespaceImport(bindings)) wholeModule = true;
        if (bindings && ts.isNamedImports(bindings)) {
          for (const element of bindings.elements) {
            if (!element.isTypeOnly) names.push((element.propertyName ?? element.name).text);
          }
        }
        refs.push({ module: resolveModule(rel, node.moduleSpecifier.text), line: lineOf(sf, node), names, wholeModule });
      }
    } else if (
      ts.isExportDeclaration(node) &&
      !node.isTypeOnly &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      const names: string[] = [];
      let wholeModule = false;
      if (!node.exportClause || ts.isNamespaceExport(node.exportClause)) {
        wholeModule = true;
      } else {
        for (const element of node.exportClause.elements) {
          if (!element.isTypeOnly) names.push((element.propertyName ?? element.name).text);
        }
      }
      refs.push({ module: resolveModule(rel, node.moduleSpecifier.text), line: lineOf(sf, node), names, wholeModule });
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const [argument] = node.arguments;
      if (argument && ts.isStringLiteralLike(argument)) {
        const names = destructuredImportNames(node);
        refs.push({
          module: resolveModule(rel, argument.text),
          line: lineOf(sf, node),
          names: names ?? [],
          wholeModule: names === null,
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return refs;
}

/** Lines with `new PrismaClient(…)` or `new <anything>.PrismaClient(…)`. */
export function clientConstructions(sf: ts.SourceFile): number[] {
  const lines: number[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isNewExpression(node)) {
      const callee = node.expression;
      const name = ts.isIdentifier(callee)
        ? callee.text
        : ts.isPropertyAccessExpression(callee)
          ? callee.name.text
          : "";
      if (name === "PrismaClient") lines.push(lineOf(sf, node));
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return lines;
}

/** True when the file's directive prologue contains "use server". */
export function hasUseServerDirective(sf: ts.SourceFile): boolean {
  for (const statement of sf.statements) {
    if (!ts.isExpressionStatement(statement) || !ts.isStringLiteral(statement.expression)) return false;
    if (statement.expression.text === "use server") return true;
  }
  return false;
}

/** Lines of "use server" directives inside function bodies (inline server functions). */
export function inlineUseServerLines(sf: ts.SourceFile): number[] {
  const lines: number[] = [];
  const visit = (node: ts.Node) => {
    if (
      (ts.isFunctionDeclaration(node) ||
        ts.isFunctionExpression(node) ||
        ts.isArrowFunction(node) ||
        ts.isMethodDeclaration(node)) &&
      node.body &&
      ts.isBlock(node.body)
    ) {
      for (const statement of node.body.statements) {
        if (!ts.isExpressionStatement(statement) || !ts.isStringLiteral(statement.expression)) break;
        if (statement.expression.text === "use server") lines.push(lineOf(sf, statement));
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return lines;
}

/** The names a module exports as values (types and interfaces are left out), sorted. */
export function valueExports(sf: ts.SourceFile): string[] {
  const names = new Set<string>();
  const hasModifier = (node: ts.Node, kind: ts.SyntaxKind) =>
    ts.canHaveModifiers(node) && (ts.getModifiers(node) ?? []).some((m) => m.kind === kind);
  for (const statement of sf.statements) {
    const exported = hasModifier(statement, ts.SyntaxKind.ExportKeyword);
    if ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) && exported) {
      names.add(hasModifier(statement, ts.SyntaxKind.DefaultKeyword) ? "default" : (statement.name?.text ?? "default"));
    } else if (ts.isVariableStatement(statement) && exported) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) names.add(declaration.name.text);
      }
    } else if (
      ts.isExportDeclaration(statement) &&
      !statement.isTypeOnly &&
      statement.exportClause &&
      ts.isNamedExports(statement.exportClause)
    ) {
      for (const element of statement.exportClause.elements) {
        if (!element.isTypeOnly) names.add(element.name.text);
      }
    } else if (ts.isExportAssignment(statement)) {
      names.add("default");
    }
  }
  return [...names].sort();
}

/**
 * Case keys written as string literals in a file, and the lines of template
 * literals that build a key at run time (which a static scan cannot read).
 * A literal is a key when it matches CASE_KEY — the same regex
 * registerCrossTenantCase() validates with, imported from cross-tenant.ts, so
 * the scan and the registration can never disagree on what a key is.
 */
export function caseKeyLiterals(sf: ts.SourceFile): { keys: string[]; dynamic: number[] } {
  const keys: string[] = [];
  const dynamic: number[] = [];
  const visit = (node: ts.Node) => {
    if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) && CASE_KEY.test(node.text)) {
      keys.push(node.text);
    } else if (ts.isTemplateExpression(node) && node.head.text.startsWith("src/") && node.getText(sf).includes("#")) {
      dynamic.push(lineOf(sf, node));
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return { keys, dynamic };
}
