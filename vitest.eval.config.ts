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
    // fixtures times three paced calls of up to 30 s each, plus the retry
    // budget (6 more calls, each with its own backoff). Worst case is a night
    // where every call times out and every retry is spent: 18x30s + 6x30s of
    // calls, 18 paces and 6 backoffs. That lands near 16 minutes, so the hook
    // gets 25 and the job (eval-live.yml) gets 30.
    hookTimeout: live ? 1_500_000 : 60_000,
  },
});
