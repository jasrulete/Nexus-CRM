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
      // Today: 70% statements, 66% branches, 75% functions, 72% lines. These
      // sit a few points under, so deleting a test file or shipping a new
      // module with none trips it, while ordinary churn does not.
      //
      // What is still uncovered, and why. src/lib/db.ts and
      // src/lib/auth/session.ts read 0% because every test mocks them — they
      // are the seam the harness fakes, so this suite structurally cannot reach
      // them. src/lib/auth/actions.ts (login, register, logout),
      // src/lib/auth/password.ts and src/lib/relations.ts have no direct tests
      // at all, and that is a real gap rather than an artefact.
      //
      // Raise this as those close. Do not raise it by narrowing `include`.
      thresholds: {
        statements: 68,
        branches: 63,
        functions: 72,
        lines: 69,
      },
    },
  },
});
