import { fileURLToPath } from "node:url";
import { configDefaults, defineConfig } from "vitest/config";

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
    // Files run in parallel, and several tests do real work (hundreds of password
    // checks, migrations replayed into fresh databases) that takes 1s alone and
    // 4-8s once every core is busy, which trips the 5s default intermittently.
    // This is a hang guard, not a speed target. The same load slows the hooks
    // (a beforeEach that truncates and reseeds a database), and vitest's own 10s
    // hook default trips under it just as the test default does, so hooks get
    // the same ceiling.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    include: ["src/**/*.test.ts"],
    // The AI evaluation harness has its own config (vitest.eval.config.ts) and
    // its own script; it may talk to real providers and is not a unit test.
    // Only that file is excluded: the pure helpers beside it (outcome.ts) are
    // ordinary units and belong in the fast suite that gates every PR.
    exclude: [...configDefaults.exclude, "src/eval/**/*.eval.test.ts"],
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
      // Today (2026-10-12): 94.6% statements, 91.36% branches, 93.63%
      // functions, 95.71% lines. These sit four to five points under: roughly
      // 65 to 80 newly uncovered lines, statements or branches, or 15 newly
      // uncovered functions, trip it, so a sizeable module shipped with no
      // tests, or a deleted test file that was the only cover for one, fails
      // the run. A smaller loss does not, and neither does ordinary churn.
      //
      // What is still uncovered, and why. src/lib/auth/session.ts and
      // src/lib/auth/password.ts read 0% because every test mocks them: they
      // are the session-cookie and bcrypt seam the harness fakes, so this suite
      // structurally cannot reach them. The rest is scattered branches, mostly
      // defensive ones, in files that are otherwise covered.
      //
      // Raise this as those close. Do not raise it by narrowing `include`.
      thresholds: {
        statements: 90,
        branches: 86,
        functions: 89,
        lines: 91,
      },
    },
  },
});
