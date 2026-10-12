/**
 * "Try the demo" signs in with the published demo credentials. In multi mode
 * that address is an ordinary registrable email, so the button would sign
 * every visitor in to whoever registered it. It is offered in single mode only
 * (spec §6: DEMO_MODE and copy are per deployment).
 *
 * Renders the real page and form to static HTML. Faked: the login action (the
 * form only needs its reference) and Next's connection().
 */
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/actions", () => ({ login: async () => ({}) }));
const request = vi.hoisted(() => ({ connection: vi.fn(async () => {}) }));
vi.mock("next/server", () => ({ connection: request.connection }));

const { default: LoginPage } = await import("./page");

afterEach(() => {
  vi.unstubAllEnvs();
  request.connection.mockClear();
});

async function renderLogin(): Promise<string> {
  return renderToStaticMarkup(await LoginPage());
}

describe("the login page", () => {
  it("offers the demo in single mode", async () => {
    vi.stubEnv("WORKSPACE_MODE", "single");

    const html = await renderLogin();

    expect(html).toContain("Try the demo");
    expect(html).toContain("Sign in");
  });

  it("offers no demo in multi mode", async () => {
    vi.stubEnv("WORKSPACE_MODE", "multi");

    const html = await renderLogin();

    expect(html).not.toContain("Try the demo");
    expect(html).toContain("Sign in");
  });

  it("is rendered per request, because the mode is read at runtime", async () => {
    vi.stubEnv("WORKSPACE_MODE", "single");

    await renderLogin();

    expect(request.connection).toHaveBeenCalledTimes(1);
  });
});
