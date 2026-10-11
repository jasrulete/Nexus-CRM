/**
 * Which Prisma models belong to a workspace (spec §5.1).
 *
 *  - TENANT rows carry `workspaceId` and are reachable only through the
 *    scoped client (`forWorkspace` / `scopeToWorkspace`).
 *  - GLOBAL rows (identity, sessions, the workspace table itself) are never
 *    reachable through the scoped client; only allowlisted files read them,
 *    through `systemDb`.
 *
 * Pure: no client is constructed here.
 */
import { Prisma } from "@/generated/prisma/client";

type ModelClass = "TENANT" | "GLOBAL";

// `satisfies Record<Prisma.ModelName, …>` makes a model added to the schema a
// type error here until someone decides which side it is on.
const MODEL_CLASS = {
  User: "GLOBAL",
  Session: "GLOBAL",
  Workspace: "GLOBAL",
  Company: "TENANT",
  Contact: "TENANT",
  Deal: "TENANT",
  Activity: "TENANT",
  Task: "TENANT",
  AuditLog: "TENANT",
  Membership: "TENANT",
  AiUsage: "TENANT",
} as const satisfies Record<Prisma.ModelName, ModelClass>;

const MODELS = Object.keys(MODEL_CLASS) as Prisma.ModelName[];

export const TENANT_MODELS: readonly string[] = MODELS.filter((m) => MODEL_CLASS[m] === "TENANT");
export const GLOBAL_MODELS: readonly string[] = MODELS.filter((m) => MODEL_CLASS[m] === "GLOBAL");

export function isTenantModel(model: string): boolean {
  return TENANT_MODELS.includes(model);
}

export function isGlobalModel(model: string): boolean {
  return GLOBAL_MODELS.includes(model);
}

// The plain columns of every model, from the generated client. A scoped write
// may carry only these keys, which is what blocks nested relation writes.
const SCALAR_FIELD_ENUMS: Record<Prisma.ModelName, Readonly<Record<string, string>>> = {
  User: Prisma.UserScalarFieldEnum,
  Session: Prisma.SessionScalarFieldEnum,
  Workspace: Prisma.WorkspaceScalarFieldEnum,
  Company: Prisma.CompanyScalarFieldEnum,
  Contact: Prisma.ContactScalarFieldEnum,
  Deal: Prisma.DealScalarFieldEnum,
  Activity: Prisma.ActivityScalarFieldEnum,
  Task: Prisma.TaskScalarFieldEnum,
  AuditLog: Prisma.AuditLogScalarFieldEnum,
  Membership: Prisma.MembershipScalarFieldEnum,
  AiUsage: Prisma.AiUsageScalarFieldEnum,
};

const SCALAR_FIELDS = new Map<string, ReadonlySet<string>>(
  MODELS.map((m) => [m, new Set(Object.values(SCALAR_FIELD_ENUMS[m]))]),
);

/** The model's scalar column names, or an empty set for an unknown model. */
export function scalarFieldsOf(model: string): ReadonlySet<string> {
  return SCALAR_FIELDS.get(model) ?? new Set();
}
