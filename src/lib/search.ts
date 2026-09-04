/**
 * Global search: the shapes and pure helpers shared by the server action, the
 * command palette and the tests. No imports and no `server-only` marker on
 * purpose — the same rule the seed forced on `ai/lead-score.ts`.
 */

export const SEARCH_MIN_CHARS = 2;
export const SEARCH_MAX_CHARS = 100;
/** Hits returned per entity type. The cap bounds the payload, not the scan. */
export const SEARCH_PER_KIND = 5;

export type SearchKind = "contact" | "company" | "deal" | "activity";

export type SearchHit = {
  kind: SearchKind;
  /** The row's id. */
  id: string;
  /** Built server-side from a fixed prefix and the id, never from user input. */
  href: string;
  title: string;
  /** Activities carry a snippet of the matching content here. */
  subtitle: string | null;
};

export type SearchResult =
  | { ok: true; hits: SearchHit[]; truncated: boolean }
  | { ok: false; message: string };

/**
 * "Maya Okafor" → ["Maya", "Okafor"]; "Ana de la Cruz" → ["Ana", "de la Cruz"];
 * "Maya" → null. First token against the first name, the rest against the last
 * — a first-name-first heuristic, and documented as such.
 */
export function nameTerms(q: string): [string, string] | null {
  const trimmed = q.trim();
  const space = trimmed.indexOf(" ");
  if (space < 0) return null;
  const first = trimmed.slice(0, space).trim();
  const rest = trimmed.slice(space + 1).trim();
  return first && rest ? [first, rest] : null;
}

/**
 * A window of `width` characters around the first case-insensitive match,
 * with "…" on any cut edge. Whitespace is collapsed first. When JavaScript
 * finds no match — SQLite's LIKE and `toLowerCase` disagree on some non-ASCII
 * input, so a row can match on the server and not here — the head of the
 * content is shown instead of nothing.
 */
export function snippet(content: string, q: string, width = 90): string {
  const text = content.replace(/\s+/g, " ").trim();
  if (text.length <= width) return text;
  const index = text.toLowerCase().indexOf(q.trim().toLowerCase());
  if (index < 0) return `${text.slice(0, width).trimEnd()}…`;
  const start = Math.max(0, index - Math.floor(width / 3));
  const end = Math.min(text.length, start + width);
  return `${start > 0 ? "…" : ""}${text.slice(start, end).trim()}${end < text.length ? "…" : ""}`;
}

/**
 * Where an activity hit opens: its deal (the most specific home), else its
 * contact, else its company. `createActivity` guarantees at least one.
 */
export function activityHref(a: {
  contactId: string | null;
  dealId: string | null;
  companyId: string | null;
}): string {
  if (a.dealId) return `/deals/${a.dealId}`;
  if (a.contactId) return `/contacts/${a.contactId}`;
  return `/companies/${a.companyId}`;
}
