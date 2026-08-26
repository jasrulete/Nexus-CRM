import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      // "server-only" throws outside a React Server Components bundler;
      // stub it so pure server modules can be unit-tested in Node.
      "server-only": fileURLToPath(
        new URL("./src/test/server-only-stub.ts", import.meta.url),
      ),
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text-summary", "lcov"],
      // Only what these tests can actually reach. The suite is Node-based and
      // collects .ts files, so React components are not merely uncovered —
      // they are uncoverable here, and counting them would make the number
      // meaningless. Generated Prisma output and scripts are excluded for the
      // same reason.
      include: ["src/lib/**/*.ts", "src/server/**/*.ts"],
      exclude: [
        "src/generated/**",
        "src/test/**",
        "**/*.test.ts",
        // A barrel of literals with no branches; including it inflates the
        // number without saying anything.
        "src/lib/constants.ts",
      ],
      // A floor, not a target, and set from the measured figure rather than an
      // aspiration — a threshold nobody can meet is one somebody deletes.
      // Today: 58% statements, 52% branches, 62% functions, 59% lines. These
      // sit a few points under, so deleting a test file or shipping a new
      // module with none trips it, while ordinary churn does not.
      //
      // The number is low for an honest reason. src/lib/db.ts and
      // src/lib/auth/session.ts read 0% because every test mocks them, and
      // src/server/actions/ai.ts, src/lib/auth/actions.ts, src/lib/password.ts
      // and src/lib/relations.ts have no direct tests at all. Raise this as
      // those are closed; do not raise it by narrowing `include`.
      thresholds: {
        statements: 55,
        branches: 48,
        functions: 58,
        lines: 55,
      },
    },
  },
});
