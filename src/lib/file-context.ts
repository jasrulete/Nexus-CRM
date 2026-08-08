/**
 * Turns an uploaded file into text for one AI draft. Nothing is stored.
 *
 * Files are read, parsed and dropped — which is what keeps uploads safe in a
 * public demo. If persistence is ever added, that reasoning no longer holds.
 */

export const MAX_FILE_BYTES = 5 * 1024 * 1024;

/**
 * The cap that actually matters. A small PDF can carry a lot of text, so a size
 * limit alone does not bound what reaches the model — or what it costs.
 */
export const MAX_CONTEXT_CHARS = 20_000;

const ACCEPTED = ["application/pdf", "text/plain", "text/markdown"] as const;

export type FileContext = { name: string; text: string; truncated: boolean };

export type ExtractError =
  | { ok: false; message: string };

export function validateUpload(file: {
  name: string;
  type: string;
  size: number;
}): ExtractError | { ok: true } {
  // Browsers report .md inconsistently — sometimes text/markdown, sometimes
  // empty — so fall back to the extension rather than rejecting a valid file.
  const byExtension = /\.(txt|md|pdf)$/i.test(file.name);
  if (!ACCEPTED.includes(file.type as (typeof ACCEPTED)[number]) && !byExtension) {
    return { ok: false, message: "Only PDF, .txt and .md files are supported." };
  }
  if (file.size > MAX_FILE_BYTES) {
    return { ok: false, message: "File is larger than 5 MB." };
  }
  if (file.size === 0) {
    return { ok: false, message: "That file is empty." };
  }
  return { ok: true };
}

export function truncate(text: string): { text: string; truncated: boolean } {
  const clean = text.replace(/\s+\n/g, "\n").trim();
  if (clean.length <= MAX_CONTEXT_CHARS) return { text: clean, truncated: false };
  return { text: clean.slice(0, MAX_CONTEXT_CHARS), truncated: true };
}

export function isPdf(file: { name: string; type: string }): boolean {
  return file.type === "application/pdf" || /\.pdf$/i.test(file.name);
}

/**
 * Kept here rather than inline in the server action so it can be tested
 * directly against a fixture. Imported dynamically: unpdf is only needed when a
 * PDF actually arrives, and it should never reach a client bundle.
 */
export async function extractPdfText(bytes: Uint8Array): Promise<string> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  const doc = await getDocumentProxy(bytes);
  const { text } = await extractText(doc, { mergePages: true });
  return Array.isArray(text) ? text.join("\n") : text;
}
