import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * The AI evaluation harness (src/eval). Kept out of the main vitest config on
 * purpose: `npm test` stays fast and deterministic, and the eval file is the
 * one that may talk to real providers when EVAL_LIVE=1.
 *
 *   npm run eval                 no key, heuristic path, seconds, runs in CI
 *   EVAL_LIVE=1 npm run eval     real providers from the environment (nightly)
 */
const live = process.env.EVAL_LIVE === "1";

export default defineConfig({
  resolve: {
    alias: {
      "server-only": fileURLToPath(new URL("./src/test/server-only-stub.ts", import.meta.url)),
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["src/eval/**/*.eval.test.ts"],
    // A live call is bounded at 30 s per provider and a fixture makes three;
    // the heuristic path finishes in milliseconds.
    testTimeout: live ? 180_000 : 30_000,
    // All fixtures are seeded and run in one beforeAll. Live, that is up to six
    // fixtures times three paced calls of up to 30 s each.
    hookTimeout: live ? 900_000 : 60_000,
  },
});
