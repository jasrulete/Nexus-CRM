import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

// `output: "standalone"` exists for the Docker image. Under a deployment adapter
// (Vercel sets NEXT_ADAPTER_PATH since Next 16.3) Turbopack no longer writes the
// root server trace, and the standalone writer then fails the whole build with
// ENOENT on .next/next-server.js.nft.json — observed on every Vercel production
// build after the Next 16.3 upgrade, and reproduced locally with a stub adapter.
async function loadConfig() {
  vi.resetModules();
  const mod = await import("../../next.config");
  return mod.default as { output?: string };
}

// The config imports the Sentry build plugin. A cold import has taken over
// thirty seconds on a loaded machine and failed the first timed test twice, so
// the import is paid once here, outside any test budget, and each test then
// only re-evaluates the (cached) module graph with its own env.
describe("next.config output mode", { timeout: 60_000 }, () => {
  beforeAll(async () => {
    await import("../../next.config");
  }, 120_000);
  afterEach(() => vi.unstubAllEnvs());

  it("keeps the standalone bundle for builds without a deployment adapter (Docker, CI)", async () => {
    vi.stubEnv("NEXT_ADAPTER_PATH", "");
    expect((await loadConfig()).output).toBe("standalone");
  });

  it("drops standalone when a deployment adapter packages the app", async () => {
    vi.stubEnv("NEXT_ADAPTER_PATH", "/vercel/adapter.js");
    expect((await loadConfig()).output).toBeUndefined();
  });
});
