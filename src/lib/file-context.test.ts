import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  MAX_CONTEXT_CHARS,
  MAX_FILE_BYTES,
  extractPdfText,
  isPdf,
  truncate,
  validateUpload,
} from "./file-context";

const file = (over: Partial<{ name: string; type: string; size: number }> = {}) => ({
  name: "notes.txt",
  type: "text/plain",
  size: 1000,
  ...over,
});

describe("validateUpload", () => {
  it("accepts the supported types", () => {
    expect(validateUpload(file()).ok).toBe(true);
    expect(validateUpload(file({ name: "a.pdf", type: "application/pdf" })).ok).toBe(true);
  });

  it("falls back to the extension when the browser reports no type", () => {
    // Browsers report .md inconsistently; rejecting on MIME alone would refuse
    // a perfectly valid file.
    expect(validateUpload(file({ name: "notes.md", type: "" })).ok).toBe(true);
  });

  it("rejects unsupported types", () => {
    const r = validateUpload(file({ name: "virus.exe", type: "application/x-msdownload" }));
    expect(r.ok).toBe(false);
    expect(r).toHaveProperty("message", expect.stringMatching(/only pdf/i));
  });

  it("rejects files over the size cap", () => {
    const r = validateUpload(file({ size: MAX_FILE_BYTES + 1 }));
    expect(r.ok).toBe(false);
    expect(r).toHaveProperty("message", expect.stringMatching(/5 MB/));
  });

  it("rejects an empty file", () => {
    expect(validateUpload(file({ size: 0 })).ok).toBe(false);
  });
});

describe("truncate", () => {
  it("leaves short text alone", () => {
    expect(truncate("  hello  ")).toEqual({ text: "hello", truncated: false });
  });

  it("caps long text and reports it", () => {
    // The size limit does not bound this: a small PDF can hold a lot of text,
    // and every character costs tokens.
    const r = truncate("x".repeat(MAX_CONTEXT_CHARS + 500));
    expect(r.truncated).toBe(true);
    expect(r.text).toHaveLength(MAX_CONTEXT_CHARS);
  });
});

describe("isPdf", () => {
  it("detects by mime type or extension", () => {
    expect(isPdf({ name: "a.pdf", type: "" })).toBe(true);
    expect(isPdf({ name: "a", type: "application/pdf" })).toBe(true);
    expect(isPdf({ name: "a.txt", type: "text/plain" })).toBe(false);
  });
});

describe("extractPdfText", () => {
  it("pulls the text out of a real PDF", async () => {
    // Fixture is a minimal one-page PDF; proves unpdf is wired correctly rather
    // than only that our own helpers agree with each other.
    const bytes = new Uint8Array(
      readFileSync(new URL("../test/fixtures/sample.pdf", import.meta.url)),
    );
    const text = await extractPdfText(bytes);
    expect(text).toContain("Acme renewal quote is 42000 USD");
  });

  it("rejects bytes that are not a PDF", async () => {
    await expect(
      extractPdfText(new TextEncoder().encode("this is not a pdf")),
    ).rejects.toThrow();
  });
});
