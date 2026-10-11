/**
 * The workspace-scoped database client (spec §5.1). It fails closed.
 *
 * One top-level `query.$allOperations` callback sees every call, including the
 * model-less raw ones that a callback under `$allModels` never sees:
 *  - raw SQL (`$queryRaw`, `$executeRaw`, `$queryRawUnsafe`, `$executeRawUnsafe`): throws;
 *  - a GLOBAL model, any operation: throws. A nested include/select of a global
 *    row (a record's owner, a membership's user) still works, because nested
 *    reads do not fire the callback;
 *  - a TENANT model: an explicit switch over every operation the installed
 *    client has, with a default that throws. Reads, updates and deletes get
 *    `workspaceId = bound` ANDed into `where`; creates are verified, never
 *    stamped; `workspaceId` can never be changed; and a write may carry only
 *    plain columns, which blocks every nested relation write.
 *
 * Pure: it never constructs a client. `db.ts` applies it to `systemDb`, and the
 * test harness applies it to its throwaway database.
 */
import type { PrismaClient } from "@/generated/prisma/client";
import { isGlobalModel, isTenantModel, scalarFieldsOf } from "./tenancy-map";

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

function buildScoped(base: PrismaClient, workspaceId: string) {
  return base.$extends({
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
}

/** The scoped client's type: the same API as PrismaClient. */
export type ScopedDb = ReturnType<typeof buildScoped>;

export function scopeToWorkspace<C extends PrismaClient>(base: C, workspaceId: string): ScopedDb {
  if (typeof workspaceId !== "string" || workspaceId === "") {
    throw new TenancyViolation("scopeToWorkspace needs a workspace id");
  }
  return buildScoped(base, workspaceId);
}
