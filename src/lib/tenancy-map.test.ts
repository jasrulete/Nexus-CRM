import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Prisma } from "@/generated/prisma/client";
import {
  GLOBAL_MODELS,
  RELATION_TARGETS,
  TENANT_MODELS,
  isGlobalModel,
  isTenantModel,
  relationTargetOf,
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

// The relation-target map is static (the prisma-client generator exports no
// DMMF), so this parses prisma/schema.prisma and holds the map to it. A schema
// change that adds, renames or retargets a relation fails here until the map
// is updated; the scoped client's nested-access walk depends on it.
type SchemaField = { name: string; type: string; list: boolean };

function parseSchemaModels(source: string): Record<string, SchemaField[]> {
  const models: Record<string, SchemaField[]> = {};
  for (const block of source.matchAll(/^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm)) {
    const fields: SchemaField[] = [];
    for (const raw of block[2].split("\n")) {
      const line = raw.replace(/\/\/.*$/, "").trim();
      if (line === "" || line.startsWith("@@")) continue;
      const field = /^(\w+)\s+(\w+)(\[\])?\??(\s|$)/.exec(line);
      if (field) fields.push({ name: field[1], type: field[2], list: field[3] !== undefined });
    }
    models[block[1]] = fields;
  }
  return models;
}

describe("relation targets", () => {
  const schema = parseSchemaModels(readFileSync(join(process.cwd(), "prisma", "schema.prisma"), "utf8"));
  const relationsIn = (model: string) => schema[model].filter((f) => MODELS.includes(f.type));

  it("parses every model of the schema", () => {
    expect(Object.keys(schema).sort()).toEqual([...MODELS].sort());
    for (const model of MODELS) expect(schema[model].length).toBeGreaterThan(1);
  });

  it.each(MODELS)("%s: the map has exactly the relation fields the schema declares", (model) => {
    const declared = Object.fromEntries(relationsIn(model).map((f) => [f.name, f.type]));
    expect(RELATION_TARGETS[model as Prisma.ModelName]).toEqual(declared);
  });

  it.each(MODELS)("%s: every other schema field is a scalar column of the generated client", (model) => {
    const plain = schema[model].filter((f) => !MODELS.includes(f.type)).map((f) => f.name);
    expect(plain.sort()).toEqual([...scalarFieldsOf(model)].sort());
  });

  it("gives no TENANT model a to-many relation to a GLOBAL model, so `_count: true` is safe", () => {
    const offenders = TENANT_MODELS.flatMap((model) =>
      relationsIn(model)
        .filter((f) => f.list && isGlobalModel(f.type))
        .map((f) => `${model}.${f.name}`),
    );
    expect(offenders).toEqual([]);
  });

  it("looks a relation up by model and field, and nothing else", () => {
    expect(relationTargetOf("Company", "owner")).toBe("User");
    expect(relationTargetOf("Membership", "workspace")).toBe("Workspace");
    expect(relationTargetOf("User", "companies")).toBe("Company");
    expect(relationTargetOf("Company", "name")).toBeUndefined();
    expect(relationTargetOf("Company", "constructor")).toBeUndefined();
    expect(relationTargetOf("Nope", "owner")).toBeUndefined();
  });
});
