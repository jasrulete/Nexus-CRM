/**
 * The workspace-scoped database client (spec §5.1). It fails closed.
 *
 * One top-level `query.$allOperations` callback sees every call, including the
 * model-less raw ones that a callback under `$allModels` never sees:
 *  - raw SQL (`$queryRaw`, `$executeRaw`, `$queryRawUnsafe`, `$executeRawUnsafe`): throws;
 *  - a GLOBAL model, any operation: throws;
 *  - a TENANT model: an explicit switch over every operation the installed
 *    client has, with a default that throws. Reads, updates and deletes get
 *    `workspaceId = bound` ANDed into `where`; creates are verified, never
 *    stamped; `workspaceId` can never be changed; and a write may carry only
 *    plain columns, which blocks every nested relation write;
 *  - nested access through a GLOBAL relation (a record's owner, a membership's
 *    user or workspace) is NOT safe by construction: a User's back-relations
 *    reach every workspace's rows. `select`, `include`, `where` and `orderBy`
 *    are walked, and under a global relation only scalar fields are allowed:
 *    `true`, or a `select` of the target's scalars. A relation key, `include`,
 *    `_count` or a relation filter under it throws.
 *
 * Pure: it never constructs a client. `db.ts` applies it to `systemDb`, and the
 * test harness applies it to its throwaway database.
 */
import type { PrismaClient } from "@/generated/prisma/client";
import { isGlobalModel, isTenantModel, relationTargetOf, scalarFieldsOf } from "./tenancy-map";

export class TenancyViolation extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TenancyViolation";
  }
}

/**
 * Every model operation of the installed Prisma client, each handled by a
 * case below. tenancy.test.ts fails when the client gains one that is not here.
 */
export const SCOPED_OPERATIONS = [
  "findUnique",
  "findUniqueOrThrow",
  "findFirst",
  "findFirstOrThrow",
  "findMany",
  "count",
  "aggregate",
  "groupBy",
  "create",
  "createMany",
  "createManyAndReturn",
  "update",
  "updateMany",
  "updateManyAndReturn",
  "upsert",
  "delete",
  "deleteMany",
] as const;
export type ScopedOperation = (typeof SCOPED_OPERATIONS)[number];

type Args = Record<string, unknown>;

function asArgs(value: unknown): Args {
  return value !== null && typeof value === "object" ? (value as Args) : {};
}

/**
 * ANDs the bound workspace into a where clause, keeping any AND the caller
 * wrote. Works for a WhereUniqueInput too, which accepts extra non-unique
 * filters: another workspace's id is then simply "not found" (P2025 for the
 * OrThrow, update and delete calls).
 */
function scopedWhere(where: unknown, workspaceId: string): Args {
  const base = asArgs(where);
  const and = base.AND === undefined ? [] : Array.isArray(base.AND) ? base.AND : [base.AND];
  return { ...base, AND: [...and, { workspaceId }] };
}

function assertPlainColumns(model: string, operation: string, data: unknown): void {
  const columns = scalarFieldsOf(model);
  for (const key of Object.keys(asArgs(data))) {
    if (!columns.has(key)) {
      throw new TenancyViolation(
        `${model}.${operation}: "${key}" is not a column of ${model}; relation writes are not allowed through the scoped client`,
      );
    }
  }
}

function assertCreateData(model: string, operation: string, data: unknown, workspaceId: string): void {
  assertPlainColumns(model, operation, data);
  if (asArgs(data).workspaceId !== workspaceId) {
    throw new TenancyViolation(
      `${model}.${operation}: data.workspaceId must be passed explicitly and equal the bound workspace`,
    );
  }
}

function assertUpdateData(model: string, operation: string, data: unknown): void {
  assertPlainColumns(model, operation, data);
  if (Object.prototype.hasOwnProperty.call(asArgs(data), "workspaceId")) {
    throw new TenancyViolation(`${model}.${operation}: workspaceId cannot be changed`);
  }
}

function assertNoCursor(model: string, operation: string, args: Args): void {
  // Prisma resolves a cursor row without the where filter, so a foreign id
  // would position the page relative to another workspace's row.
  if (args.cursor !== undefined) {
    throw new TenancyViolation(`${model}.${operation}: cursor is not supported by the scoped client`);
  }
}

// ---------------------------------------------------------------------------
// Nested access. The callback below sees only the top-level model, so a hop
// through a relation is checked here. Tenant-to-tenant nesting is safe because
// no write can link rows across workspaces (spec §5.4). A hop to a GLOBAL model
// (a record's owner, a membership's workspace) is not: a User's back-relations
// reach every workspace's rows, and a Workspace's reach every membership. So
// under a global relation only scalar fields are allowed, in `select`,
// `include`, `where` and `orderBy`, however deep the hop sits.
// ---------------------------------------------------------------------------

const LOGICAL_KEYS: ReadonlySet<string> = new Set(["AND", "OR", "NOT"]);
const RELATION_FILTER_KEYS: ReadonlySet<string> = new Set(["is", "isNot", "some", "every", "none"]);

function isPlainObject(value: unknown): value is Args {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function throughGlobal(at: string, model: string, what: string): TenancyViolation {
  return new TenancyViolation(
    `${at}: ${what} is not allowed through ${model}, a global model; a relation to a global model may only be used for its scalar fields`,
  );
}

/** A where clause for `model`; under a GLOBAL model, scalar filters only. */
function walkWhere(at: string, model: string, where: unknown): void {
  if (Array.isArray(where)) {
    for (const clause of where) walkWhere(at, model, clause);
    return;
  }
  if (!isPlainObject(where)) return;
  const global = isGlobalModel(model);
  for (const [key, value] of Object.entries(where)) {
    if (LOGICAL_KEYS.has(key) || RELATION_FILTER_KEYS.has(key)) {
      walkWhere(at, model, value);
      continue;
    }
    const target = relationTargetOf(model, key);
    if (target !== undefined) {
      if (global) throw throughGlobal(at, model, `filtering on "${key}"`);
      walkWhere(at, target, value);
    } else if (global && !scalarFieldsOf(model).has(key)) {
      throw throughGlobal(at, model, `filtering on "${key}"`);
    }
  }
}

/** An orderBy for `model`; under a GLOBAL model, scalar columns only. */
function walkOrderBy(at: string, model: string, orderBy: unknown): void {
  if (Array.isArray(orderBy)) {
    for (const entry of orderBy) walkOrderBy(at, model, entry);
    return;
  }
  if (!isPlainObject(orderBy)) return;
  const global = isGlobalModel(model);
  for (const [key, value] of Object.entries(orderBy)) {
    const target = relationTargetOf(model, key);
    if (target !== undefined) {
      if (global) throw throughGlobal(at, model, `ordering by "${key}"`);
      walkOrderBy(at, target, value);
    } else if (global && !scalarFieldsOf(model).has(key)) {
      throw throughGlobal(at, model, `ordering by "${key}"`);
    }
  }
}

/** The `_count` entry of a select/include on a TENANT model: only the filters inside it carry a where. */
function walkCount(at: string, model: string, count: unknown): void {
  const select = isPlainObject(count) ? count.select : undefined;
  if (!isPlainObject(select)) return; // `_count: true` counts the model's own to-many relations
  for (const [key, value] of Object.entries(select)) {
    const target = relationTargetOf(model, key);
    if (target === undefined) continue;
    if (isGlobalModel(target)) throw throughGlobal(at, target, `counting "${key}"`);
    if (isPlainObject(value)) walkWhere(at, target, value.where);
  }
}

/** A select or include on `model`; under a GLOBAL model, scalar fields only. */
function walkSelection(at: string, model: string, selection: unknown): void {
  if (!isPlainObject(selection)) return;
  const global = isGlobalModel(model);
  for (const [key, value] of Object.entries(selection)) {
    if (value === false || value === undefined || value === null) continue;
    if (key === "_count") {
      if (global) throw throughGlobal(at, model, `"_count"`);
      walkCount(at, model, value);
      continue;
    }
    const target = relationTargetOf(model, key);
    if (target === undefined) continue; // a scalar column
    if (global) throw throughGlobal(at, model, `selecting "${key}"`);
    if (isPlainObject(value)) walkRelationArgs(at, target, value);
  }
}

/** The args of a nested relation: `{ select | include, where, orderBy, ... }`. */
function walkRelationArgs(at: string, target: string, args: Args): void {
  if (isGlobalModel(target) && args.include !== undefined) {
    throw throughGlobal(at, target, `"include"`);
  }
  walkSelection(at, target, args.select);
  walkSelection(at, target, args.include);
  walkWhere(at, target, args.where);
  walkOrderBy(at, target, args.orderBy);
}

function assertNestedAccess(model: string, operation: string, args: Args): void {
  const at = `${model}.${operation}`;
  walkSelection(at, model, args.select);
  walkSelection(at, model, args.include);
  walkWhere(at, model, args.where);
  walkOrderBy(at, model, args.orderBy);
}

function buildScoped(base: PrismaClient, workspaceId: string) {
  const scoped = base.$extends({
    name: "workspace-scope",
    query: {
      async $allOperations({ model, operation, args, query }) {
        if (model === undefined) {
          throw new TenancyViolation(
            `${operation}: raw SQL is not allowed through the scoped client; add a named function to src/lib/system-queries.ts`,
          );
        }
        if (isGlobalModel(model)) {
          throw new TenancyViolation(
            `${model}.${operation}: ${model} is a global model and is not reachable through the scoped client`,
          );
        }
        if (!isTenantModel(model)) {
          throw new TenancyViolation(`${model}.${operation}: ${model} is not classified in tenancy-map.ts`);
        }

        const a = asArgs(args);
        assertNestedAccess(model, operation, a);
        switch (operation) {
          case "findUnique":
          case "findUniqueOrThrow":
          case "findFirst":
          case "findFirstOrThrow":
          case "findMany":
          case "count":
          case "aggregate":
          case "groupBy":
            assertNoCursor(model, operation, a);
            return query({ ...a, where: scopedWhere(a.where, workspaceId) });

          case "update":
          case "updateMany":
          case "updateManyAndReturn":
            assertUpdateData(model, operation, a.data);
            return query({ ...a, where: scopedWhere(a.where, workspaceId) });

          case "delete":
          case "deleteMany":
            return query({ ...a, where: scopedWhere(a.where, workspaceId) });

          case "upsert":
            assertCreateData(model, operation, a.create, workspaceId);
            assertUpdateData(model, operation, a.update);
            return query({ ...a, where: scopedWhere(a.where, workspaceId) });

          case "create":
            assertCreateData(model, operation, a.data, workspaceId);
            return query(a);

          case "createMany":
          case "createManyAndReturn": {
            const rows: unknown[] = Array.isArray(a.data) ? a.data : [a.data];
            for (const row of rows) assertCreateData(model, operation, row, workspaceId);
            return query(a);
          }

          default:
            throw new TenancyViolation(
              `${model}.${operation}: this operation is not handled by the scoped client`,
            );
        }
      },
    },
  });
  // A query extension stacked on this client runs outside the callback above and
  // can rewrite `where` to {}, so the type does not offer `$extends`. This is
  // type-level only: a cast can still reach it, and code review is the backstop.
  return scoped as Omit<typeof scoped, "$extends">;
}

/** The scoped client's type: the PrismaClient API without `$extends`. */
export type ScopedDb = ReturnType<typeof buildScoped>;

export function scopeToWorkspace<C extends PrismaClient>(base: C, workspaceId: string): ScopedDb {
  if (typeof workspaceId !== "string" || workspaceId === "") {
    throw new TenancyViolation("scopeToWorkspace needs a workspace id");
  }
  return buildScoped(base, workspaceId);
}
