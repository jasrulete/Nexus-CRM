/**
 * WCAG 2.2 AA contrast, enforced against the real stylesheet.
 *
 * SAAS-READINESS §1 records that the dark accent once failed AA in both of its
 * roles and was retuned by hand; the 2026-08-23 audit then found five more text
 * tokens failing, including `--ink-faint` at 2.95:1 across 81 usages in light
 * mode and 3.22:1 in dark. Both times the check was a person doing arithmetic.
 *
 * This reads the tokens out of globals.css and does the arithmetic in CI, so a
 * token edit that breaks AA fails a test instead of waiting for the next audit.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const CSS = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");

/** Pulls the `:root` (light) and `.dark` blocks apart before reading tokens. */
function themeBlock(theme: "light" | "dark"): string {
  const start = theme === "light" ? CSS.indexOf(":root {") : CSS.indexOf(".dark {");
  expect(start).toBeGreaterThan(-1);
  return CSS.slice(start, CSS.indexOf("}", start));
}

function token(theme: "light" | "dark", name: string): string {
  const match = themeBlock(theme).match(
    new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`),
  );
  if (!match) throw new Error(`token --${name} not found in ${theme}`);
  return match[1]!.toLowerCase();
}

function relativeLuminance(hex: string): number {
  const channels = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const [r, g, b] = channels.map((c) =>
    c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

function contrast(a: string, b: string): number {
  const [l1, l2] = [relativeLuminance(a), relativeLuminance(b)];
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

const SURFACES = ["canvas", "surface", "surface-2"] as const;

/**
 * Text tokens, with any extra background they are specifically paired with.
 * The semantic colours are rendered both on a plain surface (e.g. an inline
 * form error) and on their own -soft background (e.g. a badge), so both count.
 */
const TEXT_TOKENS: { name: string; alsoOn?: string[] }[] = [
  { name: "ink" },
  { name: "ink-muted" },
  { name: "ink-faint" },
  { name: "accent" },
  { name: "danger", alsoOn: ["danger-soft"] },
  { name: "success", alsoOn: ["success-soft"] },
  { name: "warn", alsoOn: ["warn-soft"] },
  { name: "chart-axis" },
];

const AA_NORMAL_TEXT = 4.5;

describe.each(["light", "dark"] as const)("%s theme meets WCAG AA", (theme) => {
  it.each(TEXT_TOKENS)("--$name on every surface it can sit on", ({ name, alsoOn }) => {
    const fg = token(theme, name);
    const backgrounds = [
      ...SURFACES.map((s) => token(theme, s)),
      ...(alsoOn ?? []).map((s) => token(theme, s)),
    ];

    for (const bg of backgrounds) {
      const ratio = contrast(fg, bg);
      expect(
        ratio,
        `--${name} (${fg}) on ${bg} is ${ratio.toFixed(2)}:1, below AA ${AA_NORMAL_TEXT}:1`,
      ).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
    }
  });

  it("--on-accent is readable on an accent fill", () => {
    // The accent serves two roles at once: link text on a surface (covered
    // above) and a button fill with on-accent text over it. A mid purple with
    // white text once failed both at ~4.2:1.
    const ratio = contrast(token(theme, "on-accent"), token(theme, "accent"));
    expect(
      ratio,
      `on-accent on accent is ${ratio.toFixed(2)}:1`,
    ).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
  });

  it("keeps the ink hierarchy visually distinct", () => {
    // Fixing contrast by collapsing ink-faint into ink-muted would pass the
    // ratios above and destroy the type hierarchy.
    const surface = token(theme, "surface");
    const ink = contrast(token(theme, "ink"), surface);
    const muted = contrast(token(theme, "ink-muted"), surface);
    const faint = contrast(token(theme, "ink-faint"), surface);

    expect(ink).toBeGreaterThan(muted);
    expect(muted).toBeGreaterThan(faint);
    expect(muted - faint).toBeGreaterThan(0.75);
  });
});
