import { describe, expect, it } from "vitest";
import { Prisma } from "@/generated/prisma/client";
import {
  GLOBAL_MODELS,
  TENANT_MODELS,
  isGlobalModel,
  isTenantModel,
  scalarFieldsOf,
} from "./tenancy-map";

const MODELS: string[] = Object.values(Prisma.ModelName);

// Read straight from the generated client, so the map is not tested against itself.
function scalarEnum(model: string): string[] {
  const enums = Prisma as unknown as Record<string, Record<string, string> | undefined>;
  return Object.values(enums[`${model}ScalarFieldEnum`] ?? {});
}

describe("tenancy map", () => {
  it.each(MODELS)("classifies %s as exactly one of TENANT or GLOBAL", (model) => {
    expect([isTenantModel(model), isGlobalModel(model)].filter(Boolean)).toHaveLength(1);
  });

  it("names no model the client does not have", () => {
    expect([...TENANT_MODELS, ...GLOBAL_MODELS].sort()).toEqual([...MODELS].sort());
  });

  it.each(MODELS)("%s is TENANT exactly when its ScalarFieldEnum has workspaceId", (model) => {
    const columns = scalarEnum(model);
    expect(columns.length).toBeGreaterThan(0);
    expect(columns.includes("workspaceId")).toBe(isTenantModel(model));
  });

  it("matches the spec's split", () => {
    expect([...TENANT_MODELS].sort()).toEqual([
      "Activity",
      "AiUsage",
      "AuditLog",
      "Company",
      "Contact",
      "Deal",
      "Membership",
      "Task",
    ]);
    expect([...GLOBAL_MODELS].sort()).toEqual(["Session", "User", "Workspace"]);
  });

  it.each(MODELS)("scalarFieldsOf(%s) is the generated ScalarFieldEnum", (model) => {
    expect([...scalarFieldsOf(model)].sort()).toEqual(scalarEnum(model).sort());
  });

  it("knows nothing about an unknown model", () => {
    expect(scalarFieldsOf("Nope").size).toBe(0);
    expect(isTenantModel("Nope")).toBe(false);
    expect(isGlobalModel("Nope")).toBe(false);
  });
});
