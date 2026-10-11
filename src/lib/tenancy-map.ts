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

/**
 * Every relation field of every model and the model it points at. Static
 * because the prisma-client generator exports no DMMF; tenancy-map.test.ts
 * parses prisma/schema.prisma and fails if this table drifts from it, so a
 * schema change cannot leave a relation the scoped client's nested-access walk
 * does not know about.
 */
export const RELATION_TARGETS = {
  User: {
    sessions: "Session",
    companies: "Company",
    contacts: "Contact",
    deals: "Deal",
    activities: "Activity",
    tasks: "Task",
    auditLogs: "AuditLog",
    membership: "Membership",
  },
  Session: { user: "User" },
  Workspace: { memberships: "Membership", aiUsages: "AiUsage" },
  Membership: { workspace: "Workspace", user: "User" },
  AiUsage: { workspace: "Workspace" },
  Company: { owner: "User", contacts: "Contact", deals: "Deal", activities: "Activity" },
  Contact: {
    company: "Company",
    owner: "User",
    deals: "Deal",
    activities: "Activity",
    tasks: "Task",
  },
  Deal: {
    contact: "Contact",
    company: "Company",
    owner: "User",
    activities: "Activity",
    tasks: "Task",
  },
  Activity: { contact: "Contact", deal: "Deal", company: "Company", user: "User" },
  Task: { contact: "Contact", deal: "Deal", assignee: "User" },
  AuditLog: { user: "User" },
} as const satisfies Record<Prisma.ModelName, Record<string, Prisma.ModelName>>;

/** The model a relation field points at, or undefined if `field` is not a relation of `model`. */
export function relationTargetOf(model: string, field: string): string | undefined {
  const relations: Readonly<Record<string, string>> | undefined = Object.hasOwn(RELATION_TARGETS, model)
    ? RELATION_TARGETS[model as Prisma.ModelName]
    : undefined;
  return relations !== undefined && Object.hasOwn(relations, field) ? relations[field] : undefined;
}
