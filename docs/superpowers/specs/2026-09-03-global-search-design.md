# W16 · Global search (⌘K) — design

Produced 2026-09-03 by a judge panel: three independent blueprints (minimal-first,
accessibility-first, product-first), scored by two judges (senior frontend/a11y,
senior backend/reliability) against the installed Radix 1.1.19, Next 16.3.1,
axe-core 4.13 and eslint-plugin-react-hooks 7.1.1 sources plus a read-only Prisma
probe, then synthesized. Sits beside the four earlier specs in this directory.

## 1. Decision

Build the accessibility-first blueprint: Radix Dialog primitives composed directly,
a WAI-ARIA editable combobox with `aria-activedescendant` over a grouped listbox,
and one `"use server"` action `searchRecords`. Grafted from the others: an explicit
`onCloseAutoFocus` that restores the element focused before a shortcut-open
(Radix's modal Dialog always focuses the Trigger otherwise — `@radix-ui/react-dialog/dist/index.mjs:148-151`,
and `composeEventHandlers` lets the caller's `preventDefault()` suppress it); a
visible `role="status"` line that sighted and screen-reader users read together;
wildcard / ASCII-case / neighbour-not-charged pin tests; validate-before-charging;
deal-first activity hrefs; `ControlOrMeta+k`; 44 px rows and a 16 px mobile input.
Constants live in `src/lib/search.ts`, not `constants.ts`.

**No new dependency.** cmdk's value is client-side filtering, which the acceptance
forbids; the keyboard/ARIA layer we would keep is ~60 lines whose correctness axe
and Playwright assert directly. The judges also rejected: reusing `DialogContent`
(it hard-codes a visible title row, `p-6` and a Close button); `aria-haspopup` on
the combobox (redundant under the APG and trips axe's `controlsWithinPopup`
review); any synchronous `setState` in an effect body (`react-hooks/set-state-in-effect`
is an Error in the preset `eslint-config-next` spreads); in-memory ranking over a
recency-truncated window (fails exactly when ranking would matter); `router.prefetch`
per ArrowDown (one RSC render per keypress on Vercel Hobby); stripping `_` from
queries to "escape" LIKE (breaks `j_whitfield@`).

## 2. Files

- create `src/lib/search.ts` — import-free, client-safe: `SEARCH_MIN_CHARS=2`,
  `SEARCH_MAX_CHARS=100`, `SEARCH_PER_KIND=5`, `SearchKind`/`SearchHit`/`SearchResult`,
  pure `nameTerms`, `snippet`, `activityHref`.
- create `src/lib/search.test.ts` — pure vitest for the three helpers.
- modify `src/lib/validation.ts` — `searchQuerySchema` (trim, min 2, max 100).
- modify `src/lib/validation.test.ts` — three cases.
- create `src/server/actions/search.ts` — `searchRecords(rawQuery)`; carries the
  bounding + FTS5 comment.
- create `src/server/actions/search.test.ts` — harness-backed suite.
- create `src/components/command-palette.tsx` — `"use client"`; header trigger,
  ⌘K/Ctrl+K listener, dialog, combobox, listbox, status line.
- modify `src/app/(app)/layout.tsx` — `<CommandPalette />` first in the header.
- modify `e2e/crm.spec.ts` (three tests) and `e2e/accessibility.spec.ts` (axe scan of
  the open palette with results).
- modify `src/app/(app)/settings/page.tsx` — "Login and AI endpoints rate-limited" →
  "Login, AI and search actions rate-limited".
- docs: README, ENGINEERING-PLAN, PRD, USER-FLOWS, TECHNICAL-DESIGN, DATA-MODEL,
  GLOSSARY, DESIGN-BRIEF, SECURITY, HANDOVER, IMPROVEMENT-PLAN.

## 3. Server

**Transport: server action, not a route handler.** TECHNICAL-DESIGN §4 ("Server
Actions everywhere"); `requireUser()` first, like every sibling; the harness tests
this layer against real migrations; Next's origin check comes free; POST-only means
results are never URL-addressable or cached. Cost (Next docs, `server-actions.md`):
the client dispatches actions one at a time — so parallelism lives in one
server-side `Promise.all`, the client debounces 150 ms, and a sequence counter drops
stale responses.

```ts
export async function searchRecords(rawQuery: string): Promise<SearchResult>
```

1. `requireUser()`.
2. `searchQuerySchema.safeParse` — validate before charging the bucket; `{ ok: false, message }` on failure.
3. `sweepExpiredBuckets(); rateLimit(\`search:${user.id}\`, { limit: 120, windowMs: 60_000 })` —
   ~2/s sustained; per-instance memory like every bucket here (defence in depth on Vercel).
4. `take = SEARCH_PER_KIND + 1` — one extra row says "more exist" without a `count()`.
5. Four `findMany`s in `Promise.all`, each `select`-only:
   - contacts: `OR` over firstName, lastName, email, title, notes, plus
     `AND(firstName contains first, lastName contains rest)` when `nameTerms(q)`; `updatedAt desc`.
   - companies: name, domain, industry, notes; `updatedAt desc`.
   - deals: title; `updatedAt desc`.
   - activities: content; `createdAt desc`.
6. `truncated = any group.length > SEARCH_PER_KIND`; groups cut to 5; fixed order
   contacts → companies → deals → activities; no scoring (a fake relevance number is
   worse than none — FTS5's bm25 provides one later).
7. Hit shapes: contact subtitle `title · company` (else email); company `domain · industry`;
   deal `Stage · formatDealAmount · company`; activity title `"<Type> on <deal | contact | company>"`
   with the same priority as `activityHref`, subtitle `snippet(content, q)`.

**Bounding comment (verbatim in the action):** SEARCH_PER_KIND rows per entity type,
so at most 4 × (SEARCH_PER_KIND + 1) rows leave the database per keystroke however
large the workspace gets. Every branch is a Prisma `contains`, which SQLite runs as
`LIKE '%q%'` — a full scan of the column, unindexable by construction. Over
`Activity.content` and the two notes columns that is fine at demo scale and is the
first thing to fall over at real scale: the cap bounds the *result*, not the scan, and
Turso bills scanned rows against the free tier's row-read quota. The free upgrade path
is SQLite FTS5 — a virtual table over the searched columns, kept in step by triggers in
one migration, queried with MATCH (bm25 ranking for free) via `$queryRaw`.
better-sqlite3 and libSQL both ship it; no new service. Do that when a search passes
~100 ms, not before.

**Verified SQLite semantics:** `contains` compiles to `LIKE ('%' || ? || '%')` with no
`ESCAPE` — `%`/`_` act as wildcards; the generated `StringFilter` has no `mode` on SQLite;
case folding is ASCII-only. Not worked around; bounded by the cap and pinned by a test.

**Auth:** `requireUser()` only. Nothing is mutated: no `canMutate`, no audit entry, no
demo guard. Reads are workspace-wide (DATA-MODEL, "Ownership is authorization, not
scoping"); a MEMBER sees records owned by the ADMIN, pinned by a test.

## 4. UI

Mount: `src/app/(app)/layout.tsx` header, first child. Component composes Radix
primitives directly (`Root` / `Trigger asChild` / `Portal` / `Overlay` / `Content` /
sr-only `Title` "Search" / sr-only `Description` carrying the keyboard instructions).

Trigger: `<Button variant="ghost" size="sm" aria-keyshortcuts="Control+K Meta+K">`
with a `Search` icon, `<span className="max-md:sr-only">Search</span>` (accessible
name "Search" on every viewport) and an `aria-hidden` `⌘K` kbd on `md+`.

Input: `role="combobox"`, `aria-autocomplete="list"`, `aria-expanded` always present,
`aria-controls` only while expanded, `aria-activedescendant` only when the referenced
option is in the same render (the active hit is *derived* from `hits`, so it can never
dangle across an async re-render); named by an sr-only `<label for>`; `autoComplete`,
`autoCorrect`, `autoCapitalize` off; `enterKeyHint="go"`; `text-base md:text-sm` (stops
iOS auto-zoom).

Status: visible `<p role="status" aria-live="polite" aria-atomic="true">`, updated only
when a result *settles*: `"7 results — 2 contacts, 1 company, 3 deals, 1 note."`, plus
`" Showing the first 5 of each type — keep typing to narrow."` when truncated;
`"No matches for “zzz”."`; the server's message on `ok:false`; `"Couldn't search just
now — try again."` when the action throws. Blank while too-short or pending.

Listbox: `role="listbox"` + `aria-label="Search results"`, rendered only when there
are hits (so `aria-required-children` never sees an empty listbox); scrolls inside
`max-h-[60dvh]` — axe's `scrollable-region-focusable` exempts an element referenced by a
combobox's `aria-controls`. Groups: `role="group"` + `aria-labelledby` → a plain heading
`<div>` (Contacts / Companies / Deals / Notes). Options: `<div role="option">` with `id`,
`aria-selected`, no tabindex; `onPointerMove` highlights; `onMouseDown` prevented so focus
stays in the input; click selects; `min-h-11` (44 px targets).

Keyboard: ⌘K / Ctrl+K anywhere (`document` keydown, `!e.repeat`, no Shift/Alt,
`preventDefault()` to beat Chrome's address-bar Ctrl+K; records `document.activeElement`
as the opener; toggles). ↓/↑ move the highlight through the flat hit list across group
boundaries, wrapping (`preventDefault` so the caret stays). Home/End not intercepted.
Enter with an active hit: close + `router.push(hit.href)`. Escape: Radix closes
(single stage). Tab: Radix trap; the input is the only tabbable.

Focus: open → Radix focuses the input (only tabbable). Close → `onCloseAutoFocus`
restores the recorded opener if it is still connected (`e.preventDefault(); el.focus()`),
else falls through to Radix, which focuses the Trigger. Do not claim Next focuses the
new route after `router.push`: 16.3.1's default scroll handler does not.

State: `open`, `query`, `activeKey`, `result: { query, data } | null`; refs `seqRef`,
`openerRef`. Effect on `[query]`: debounce 150 ms → `searchRecords` → set only if
`seq === seqRef.current`; no synchronous `setState` in any effect body. Stale-while-
loading: previous list stays visible while the next query is pending. Closing resets
everything and bumps `seqRef`.

## 5. Tests (RED first)

Order: `src/lib/search.test.ts` (module missing) → `validation.test.ts` cases (schema
undefined) → `src/server/actions/search.test.ts` (module missing) → implement →
green. Then the Playwright tests (no dialog named "Search") → implement the component
→ green. The action suite covers: last-name hit with href/title/subtitle; full name
first-name-first (and the reverse not matching — documented); contact and company
notes; company by name/domain/industry; deal subtitle "Proposal · $11,231 (EUR 9,600)";
note hit href/title/snippet; deal-first href for an activity on both; ASCII case;
workspace-wide reads; group order; recency within a group; exact hit shape; cap at 5
with take+1 truncation; wildcards pass through bounded; validation before any query;
per-user rate limit not charged to a neighbour; session required.

e2e: keyboard open → type "brightline" → arrow to the company → Enter → `/companies/…`;
note search from the header button → Ingrid Svensson; Escape + "No matches" + focus
return (shortcut → previous element; button → button); an axe scan of the open palette
with results.

## 6. Docs to update

README features; ENGINEERING-PLAN W16 shipped + §8; PRD §7.12 acceptance table + route
→ action map; USER-FLOWS §12 flow; TECHNICAL-DESIGN §4 action count (22), §9 rate-limit
row, §14 counts, §16 LIKE-scan weakness + FTS5 path; DATA-MODEL ownership paragraph +
notable gaps; GLOSSARY action count, command-palette subsection, helpers; DESIGN-BRIEF
component inventory + responsive; SECURITY rate-limit list; IMPROVEMENT-PLAN row 4;
HANDOVER.

## 7. Verification

`npm test -- <the three files>`, `npm run typecheck`, `npm run lint`
(`set-state-in-effect` must not fire), `npm run test:coverage`, clean `.next`,
`npm run build`, `npm run test:e2e`, mojibake sweep of every edited Markdown file.

## 8. Open risks

1. Scans, not results, grow — FTS5 when a search passes ~100 ms.
2. Wildcards pass through (`%`, `_`); worst case "everything matches", still 5 per type;
   nothing is disclosed a list page would not show.
3. Sequential, non-abortable action dispatch; the sequence counter keeps the UI correct.
   A `GET` route handler is the drop-in if typeahead latency ever matters.
4. `ControlOrMeta+k` under headless Chromium; the header-button test covers the ARIA path
   independently.
5. Full-name matching is first-token/rest; "Okafor Maya" falls back to the per-column OR.
6. Screen-reader announcement of grouped `aria-activedescendant` options is not audited.
7. Highlighted-row contrast is asserted only by the axe scan.
8. A thrown `UNAUTHORIZED` reaches the client as a generic error (production masks
   server-action error text) until the next navigation redirects to `/login`.
9. No component-level unit test — vitest collects only `src/**/*.test.ts` in node.
