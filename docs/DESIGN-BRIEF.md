# Nexus CRM — Design Brief

This is a design brief for Nexus CRM as it is actually built, not an aspirational
version of it. Every token, ratio and file path below is taken from the source in
this repository. Where the docs record a measured number (contrast ratios, in
particular) that number is quoted rather than estimated.

Nexus CRM is a single-developer portfolio project: an AI-augmented CRM built to
demonstrate full-stack product judgment, not a commercial product with a design
team or a brand book. This brief exists so its author — and anyone evaluating the
work — can see the system as a system, and so a designer picking it up would know
where the real decisions were made and where they weren't.

---

## 1. Brand positioning and tone

Nexus CRM's own marketing copy states its position plainly: **"Every relationship,
one intelligent workspace"** (`src/components/landing/hero.tsx`,
`src/app/(auth)/layout.tsx`). Three pillars repeat verbatim across the landing
page, the sign-in brand panel and the feature grid — pipeline that moves with
you, AI on every record, security by default — so a visitor gets the same three
sentences whichever door they walk through
(`src/components/landing/feature-grid.tsx`, `src/app/(auth)/layout.tsx`).

The tone is confident but plain: no exclamation points, no growth-hacker copy, no
fake social proof. The footer is explicit about what the project actually is —
*"A portfolio project built by Jeric Rulete to explore full-stack product work:
AI features, authentication and deployment on a free-tier stack"*
(`src/components/landing/landing-footer.tsx`) — and the hero badge reads **"Free,
open source, self-hosted"** rather than a value proposition aimed at buyers. This
is a deliberate choice: the product is not trying to look like it has a sales
team behind it, because it doesn't, and pretending otherwise would read as false
to the technical audience (recruiters, engineers) who are its actual users.

The visual voice matches: dense information surfaces (tables, kanban cards,
dashboard tiles) rendered in a restrained, mostly-monochrome UI with a single
accent color doing all the emphasis work. Nothing about the interface tries to
look "friendly" via illustration or mascot — the personality comes from the
brand mark (a small hub-and-satellite glyph, see §7) and from typography, not
from decoration.

---

## 2. Design system as built

### 2.1 Token architecture

All color lives in `src/app/globals.css` as CSS custom properties on `:root`
(light) and `.dark` (dark), then re-exposed to Tailwind v4 via an `@theme
inline` block that maps `--color-*` Tailwind tokens onto the same variables.
This is the key structural decision: **components never hard-code a hex value or
reach for a raw Tailwind color** (`bg-violet-600`, `text-zinc-900`) for anything
that has to work in both themes — they use semantic class names (`bg-accent`,
`text-ink-muted`, `border-edge`) that Tailwind resolves through the CSS
variable, which in turn resolves through whichever theme class is on `<html>`.
Change a token once in `globals.css` and every component that uses it updates,
in both themes, with no component edit — this is exactly what happened when the
dark accent was retuned for contrast (§6).

The one place raw Tailwind palette colors are used deliberately is
`src/components/ui/avatar.tsx`'s six-color name-hash tint set and
`src/components/kanban/column.tsx`'s stage-dot colors — both are decorative
categorical accents, not text-bearing UI, so they're exempted from the
token discipline by design.

### 2.2 Color tokens (semantic names, as defined)

| Token | Light | Dark | Role |
|---|---|---|---|
| `--canvas` | `#f7f7f8` | `#0c0c0e` | Page background |
| `--surface` | `#ffffff` | `#18181b` | Card / panel background |
| `--surface-2` | `#f4f4f5` | `#212125` | Nested / hover surface |
| `--edge` | `#e4e4e7` | `#27272b` | Default border |
| `--edge-strong` | `#d4d4d8` | `#3f3f46` | Emphasized border (inputs, dividers) |
| `--ink` | `#18181b` | `#f4f4f5` | Primary text |
| `--ink-muted` | `#52525b` | `#a1a1aa` | Secondary text |
| `--ink-faint` | `#8e8e98` | `#6f6f78` | Tertiary text / placeholders |
| `--accent` | `#7c3aed` | `#a78bfa` | Brand purple — links, primary actions, focus rings |
| `--accent-hover` | `#6d28d9` | `#c4b5fd` | Hover state for accent surfaces |
| `--accent-soft` | `#f5f3ff` | `#2e1065` | Tinted backgrounds (badges, active nav) |
| `--on-accent` | `#ffffff` | `#1e1b4b` | Text/icon color placed on top of `--accent` |
| `--danger` / `--danger-soft` | `#dc2626` / `#fef2f2` | `#ef4444` / `#2a1414` | Destructive actions, error states |
| `--success` / `--success-soft` | `#16a34a` / `#f0fdf4` | `#22c55e` / `#10231a` | Won deals, positive states |
| `--warn` / `--warn-soft` | `#d97706` / `#fffbeb` | `#f59e0b` / `#27200d` | Qualified/proposal/negotiation states |

The naming convention is deliberately about **role, not appearance** — `ink`
rather than `gray-900`, `edge` rather than `border-color` — so the same class
name is correct after a future retint. This paid off directly: the dark-mode
accent was changed twice (once during the initial build, once during the
2026-07-25 accessibility pass) without touching a single component file,
because every consumer referenced `--accent`, never a hex value.

### 2.3 Light/dark strategy — class-based, not media-query-based

Theming is **class-based** (`.dark` on `<html>`), driven by `localStorage`, not
`prefers-color-scheme`. Three files implement this:

1. **`public/theme-init.js`** — a synchronous, render-blocking script
   (`strategy="beforeInteractive"` in `src/app/layout.tsx`) that reads
   `localStorage.getItem("theme")`, falls back to
   `matchMedia("(prefers-color-scheme: dark)")` only if nothing is stored, and
   toggles the `.dark` class on `document.documentElement` **before** React
   hydrates. This is what prevents a flash of the wrong theme on load.
2. **`src/components/theme-toggle.tsx`** — flips the class directly and writes
   the new preference to `localStorage`. Notably it carries **no React state**
   at all: the icon swap (`Sun`/`Moon`) is done with `dark:` Tailwind variants
   reading the same DOM class, so there's no hydration mismatch to manage.
3. **`src/app/globals.css`** — `@custom-variant dark (&:where(.dark, .dark
   *));` teaches Tailwind v4 to treat `.dark` as the dark-mode selector instead
   of its default `prefers-color-scheme` media query.

**Why this distinction caused a real bug.** Because the source of truth is a
class set from `localStorage`, it can disagree with the OS-level color scheme —
sign in, switch to dark, sign out, and the *signed-out* landing page should
still render dark, because that's the user's stored preference, not the OS's.
Early in the build the proxy's route matcher (`src/proxy.ts`) excluded common
static-asset extensions from the auth gate but not `.js`, so an unauthenticated
request for `/theme-init.js` itself got redirected to `/login` (307) instead of
served. The visible symptom: a signed-out visitor who had picked dark mode
still got a **light** landing page and login page, because the script that
applies the class from `localStorage` never ran — only after signing in (once
inside the authenticated app shell) did dark mode reappear, because nothing
gates the app shell's own scripts. Documented as fix #2 in the 2026-08-01 pass
of `SAAS-READINESS.md`; the fix was excluding `theme-init.js` from the proxy
matcher explicitly. This is a direct consequence of choosing
localStorage-driven theming over `prefers-color-scheme`: a CSS-only media-query
approach can never be blocked by an auth gate, because it needs no script and no
network request. The tradeoff was accepted because `prefers-color-scheme`
cannot represent "the user told this app they prefer dark," only "the OS is in
dark mode" — and the two are allowed to differ once the app stores its own
preference.

### 2.4 Typography

Three Google Fonts, loaded via `next/font/google` in `src/app/layout.tsx` and
exposed as CSS variables consumed by the `@theme inline` block in
`globals.css`:

| Tailwind token | Font | Used for |
|---|---|---|
| `--font-display` | **Space Grotesk** (falls back to DM Sans, then sans-serif) | `h1`–`h4` only, applied globally via a bare element selector in `globals.css` |
| `--font-sans` | **DM Sans** (falls back to `system-ui`) | Body text — set on `body` |
| `--font-mono` | **Geist Mono** | Not observed in active use in components inspected; reserved for code/data display |

The pairing is a geometric display face (Space Grotesk — distinct, slightly
technical letterforms, used sparingly for headings) over a humanist grotesque
body face (DM Sans — high legibility at small sizes, which matters given how
much of the UI runs at `text-[13px]` and `text-[11px]`). Type sizes throughout
the component library skew small and precise (`text-[11px]`, `text-[12px]`,
`text-[13px]` appear constantly alongside Tailwind's standard `text-sm`) rather
than using Tailwind's default scale exclusively — a deliberate density choice
for a data-dense CRM UI, not an oversight.

### 2.5 Spacing, radius, and elevation

There is no custom spacing scale — the app uses Tailwind v4's default spacing
tokens throughout (`px-3`, `gap-2`, `p-6`, etc.). Radius is not tokenized
either, but a consistent *pattern* is visible by convention across
`src/components/ui/`:

| Radius class | Used for |
|---|---|
| `rounded-md` | Small icon buttons (dialog close) |
| `rounded-lg` | Buttons, inputs, nav items, stage dots' containers |
| `rounded-xl` | Cards, dropdown menus, empty-state icon wells |
| `rounded-2xl` | Modal/dialog surfaces |
| `rounded-full` | Badges, avatars, filter chips |

Elevation is shadow-based and equally understated — `Card`
(`src/components/ui/card.tsx`) ships a near-invisible resting shadow
(`shadow-[0_1px_2px_rgb(0_0_0/0.04)]`) that only becomes a real elevation cue on
hover, when `interactive` cards lift 2px and gain a heavier shadow
(`shadow-[0_6px_16px_rgb(0_0_0/0.08)]`). Dialogs use Tailwind's `shadow-2xl`,
dropdown menus `shadow-xl`, chart tooltips `shadow-lg` — a rough three-tier
scale (surface < dialog/menu < nothing higher) with no named tokens, kept
consistent by convention rather than enforcement.

---

## 3. Component inventory (`src/components/ui/`)

| Component | File | Notes |
|---|---|---|
| `Button` | `button.tsx` | 4 variants (`primary`, `secondary`, `ghost`, `danger`) × 3 sizes (`sm`, `md`, `icon`). `danger` is the only variant with a two-stage hover (tinted → solid red on hover) rather than a static color, so a destructive action visibly escalates under the cursor. |
| `Card` / `CardHeader` | `card.tsx` | `interactive` prop opts into hover lift; ships its own `motion-reduce:` overrides (§8). |
| `Badge`, `ContactStatusBadge`, `StageBadge` | `badge.tsx` | Generic pill plus two record-status-aware wrappers that map enum values (`LEAD`/`QUALIFIED`/`CUSTOMER`/`CHURNED`, six deal stages) to the semantic soft-color tokens. |
| `Input`, `Textarea`, `Select`, `Label`, `FieldError` | `input.tsx` | Share one base class string so all form controls have identical height, border and focus ring. `Select`'s chevron is a hand-inlined SVG data URI rather than a Radix/native control, colored to the `--chart-axis` gray so it doesn't need its own dark-mode variant. |
| `Dialog`, `DialogContent` | `dialog.tsx` | Thin wrapper over `@radix-ui/react-dialog`. Always renders a `DialogPrimitive.Description` — visible if passed, `sr-only` if not — so Radix's console warning about a missing accessible description never fires. |
| `Menu`, `MenuContent`, `MenuItem`, `MenuSeparator` | `dropdown.tsx` | Wrapper over `@radix-ui/react-dropdown-menu`; `MenuItem` takes a `destructive` boolean that swaps its highlighted-state color to the danger tokens. |
| `Table`, `THead`, `Th`, `Td`, `TRow` | `table.tsx` | `Table` self-wraps in `overflow-x-auto` so any table is horizontally scrollable on narrow viewports without each call site remembering to add it. |
| `Avatar` | `avatar.tsx` | No image upload anywhere in the app — this is the only avatar representation. Deterministic hash-based tint from one of 6 colors so the same name always gets the same color across renders and sessions. |
| `EmptyState` | `empty-state.tsx` | Icon + title + optional hint + optional action, used consistently across empty tables/lists. |
| `FilterChip` | `filter-chip.tsx` | Explicitly a `<Link>`, not a button with `onClick` — the code comment notes this keeps filtered views shareable via URL and back-button-safe, and that it was extracted after the contacts and companies pages had each grown their own chip with different borders and hover states. |

The inventory is small and flat by design — ten files, no variant-explosion
component libraries, no separate "primitives" vs "patterns" layer. That fits a
single-developer, single-tenant app: the component set only grew when two call
sites had already duplicated something (the `FilterChip` comment says this
outright).

---

## 4. Data visualization

Two chart components, both in `src/components/charts/`, both built on
**Recharts**:

- **`PipelineChart`** (`pipeline-chart.tsx`) — a bar chart of open pipeline
  value by stage, ordered to match the funnel. Bars use a **4-step ordinal
  single-hue ramp**: `--ramp-1` through `--ramp-4`, going light-to-dark, so the
  visual weight of a bar increases with funnel progress even without reading
  the axis labels.
- **`RevenueChart`** (`revenue-chart.tsx`) — a line chart of revenue won per
  month, using the single `--chart-1` token for the line, dot fill, and active
  dot.

### CVD-safe palette

The palette is explicitly commented as "validated" in `globals.css` (`/*
data-viz (validated reference palette, light/dark) */`) and both README.md and
this repo's own conventions describe it as CVD-validated (color-vision-deficiency
safe). It is a **single-hue blue ramp**, not a multi-hue categorical palette —
the deliberate choice for a CVD-safe design when a value has inherent order (as
pipeline stages do): a lightness gradient reads correctly under protanopia,
deuteranopia and tritanopia simulation in a way that a red/green or red/blue
multi-hue palette would not.

| Token | Light | Dark |
|---|---|---|
| `--chart-1` (line/single-series) | `#2a78d6` | `#3987e5` |
| `--ramp-1`…`--ramp-4` (bar ramp, light→dark) | `#86b6ef` → `#5598e7` → `#2a78d6` → `#1c5cab` | `#184f95` → `#256abf` → `#3987e5` → `#6da7ec` |
| `--chart-grid` | `#e1e0d9` | `#2c2c2a` |
| `--chart-axis` | `#898781` | `#898781` (same value both themes) |

Note that `--chart-grid` and `--chart-axis` are warm-neutral (slightly olive/tan
undertones — `#e1e0d9`, `#898781`) rather than the cool zinc grays used
everywhere else in the UI (`--edge`, `--ink-faint`). This is a small, real
inconsistency: the chart chrome doesn't share a hue family with the rest of the
token set, most visible if a chart card and a regular card sit side by side —
worth flagging to a designer rather than treating as intentional, since nothing
in the codebase explains it.

Both charts are wrapped in a `role="img"` container with a descriptive
`aria-label` (e.g. `"Open pipeline value by stage"`) so the chart's meaning
survives for screen reader users even though Recharts renders to SVG with no
inherent semantics. Tooltips share one component, `ChartTooltipFrame`
(`chart-tooltip.tsx`), which renders a bordered surface-colored card with a
label row and value rows, each optionally prefixed with a color swatch —
keeping tooltip chrome (border, shadow, type scale) identical between the two
chart types.

---

## 5. Iconography

**lucide-react** (`^1.24.0` in `package.json`) is the only icon set in use,
consistently as line icons at `h-4 w-4` (16px) or `h-[18px] w-[18px]` in the
sidebar. No icon font, no custom SVG icon set beyond the two brand assets
below. Icons are used functionally (nav items, empty states, buttons) — there's
no decorative icon usage beyond the feature-grid pillars on the landing page.

The one bespoke SVG is the brand mark itself (`src/components/brand.tsx`,
`NexusGlyph`): a hub node connected to three satellite nodes by strokes,
rendered in `currentColor` so it inherits `--on-accent` from its wrapper. The
component comment states the intent directly — "a network of relationships,
which is what the CRM manages" — making it one of the few places the product's
actual domain concept (relationships as a graph) surfaces visually rather than
just functionally.

---

## 6. Motion and reduced-motion handling

Motion in the app is minimal and mostly limited to state transitions
(`transition-colors`, `transition-opacity`) rather than choreographed
animation. The one component with real motion is `Card`'s `interactive`
variant (`src/components/ui/card.tsx`): a 200ms transform/shadow/border-color
transition producing a 2px hover lift, used on the landing page's feature
cards.

That same component is the only place in the codebase with an explicit
`motion-reduce:` override:

```
"hover:-translate-y-0.5 hover:border-edge-strong",
"hover:shadow-[0_6px_16px_rgb(0_0_0/0.08)]",
"motion-reduce:transition-none motion-reduce:hover:translate-y-0",
```

The code comment explains the intent precisely: *"Respect users who ask for
less movement; the border and shadow still respond, so the affordance survives"*
— i.e. `prefers-reduced-motion` users lose the translate animation but keep
the border/shadow hover feedback, so the card still visibly communicates
"this is clickable" without the motion that reduced-motion users asked to
avoid. Radix's own dialog/dropdown open/close animations
(`data-[state=open]:animate-in data-[state=open]:fade-in` in `dialog.tsx`)
are not wrapped in a `motion-reduce:` guard — a narrower gap than it might
first appear, since Radix's default open/close transitions are brief opacity
fades rather than the kind of large-amplitude movement `prefers-reduced-motion`
users are usually trying to avoid, but it is not neutralized the way the card
hover explicitly is.

---

## 7. Accessibility commitments

### 7.1 The dark-accent contrast rule

The project has a documented, tested rule that the accent color token
(`--accent`) must pass WCAG AA contrast **in two different roles
simultaneously**, because the same token is reused for both:

- as **link/text-on-surface** color (accent text sitting on `--canvas` /
  `--surface`), and
- as a **button fill** with `--on-accent` text on top of it.

A single token serving both roles means a hue/lightness choice that satisfies
one role can fail the other — light purple text is easy to read on a dark
background but the same purple as a button fill, with dark text on it, can
still fail if the button text color isn't tuned in step. This is exactly what
happened and was measured, per `SAAS-READINESS.md` §1:

| State | Ratio | Result |
|---|---|---|
| Dark mode, original accent, link text | 4.18:1 | **Failed AA** (needs 4.5:1) |
| Dark mode, original accent, button text | 4.23:1 | **Failed AA** |
| Dark mode, retuned accent, link text | **6.5:1** | Pass |
| Dark mode, retuned accent, button text | **5.9:1** | Pass |
| Dark mode, retuned accent, badges | **5.6:1** | Pass |
| Light mode (both roles) | 5.3–7.1:1 | Already passing |

The fix, documented in `globals.css` itself as a code comment on the `.dark`
block, was a hue/value change rather than a per-component patch: *"Light
purple with dark text: the same token serves link text on dark surfaces
(6.5:1) and button fills (5.9:1). A mid purple with white text failed both at
~4.2:1."* Concretely, dark mode moved from a mid-saturation purple with white
button text to a **lighter purple (`#a78bfa`) with dark indigo button text
(`--on-accent: #1e1b4b`)** — inverting which end of the lightness scale carries
the contrast burden. Because every consumer of the accent color goes through
the `--accent`/`--on-accent` tokens (§2.1), this was fixed once, centrally, and
verified to apply everywhere the tokens are used — no component-by-component
audit was needed after the token change.

### 7.2 Other accessibility work done

- Account menu (icon-only trigger) gained an accessible name
  (`SAAS-READINESS.md` §1) — a real gap that existed until the first audit
  pass.
- Charts carry `role="img"` and a descriptive `aria-label` rather than relying
  on SVG content alone (§4).
- Dialogs always render an accessible `Description` (visible or `sr-only`) so
  Radix's built-in warning about undescribed dialogs never fires
  (`dialog.tsx`).
- Focus states are consistent and visible: interactive elements use
  `focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent`
  (buttons, links) or `focus:outline-2 focus:outline-offset-1 focus:outline-accent`
  (form inputs) — always the accent token, never a browser default outline
  color that could clash with either theme.

### 7.3 ~~Known, documented accessibility gap~~ — resolved: the kanban has a keyboard path

**Kanban drag used to have no keyboard path** — `board.tsx` wired only
`PointerSensor`, and `IMPROVEMENT-PLAN.md` flagged it against WCAG 2.1.1
(Keyboard) and 4.1.2 (Name, Role, Value) as the largest accessibility gap in
the app. `src/components/kanban/board.tsx` now registers a `KeyboardSensor`
beside the `PointerSensor` with a board-aware coordinate getter: cards are
focusable, **Space** picks a card up, the **arrow keys** move it between
columns, **Space** drops it, **Escape** cancels, and **Enter** opens the card
without starting a drag. `e2e/crm.spec.ts` moves a card to a neighbouring
column with only the keyboard and asserts the stage persists after a reload.

---

## 8. Responsive breakpoints

The app uses Tailwind's default breakpoint scale (`sm`, `md`, `lg`), applied
inconsistently in scope — some layouts branch at `md:`, the sign-in split
layout branches at `lg:`, and there is no custom breakpoint defined anywhere in
`globals.css`.

**Sidebar** (`src/components/sidebar.tsx`): icon-only rail below `md`
(`w-16`), fixed 224px (`w-56`) icon+label rail at `md` and above. There is no
collapsed/hamburger mobile state — the sidebar is always present, just
narrower, which keeps navigation reachable at every width but leaves limited
horizontal room for content on phone-width screens next to a permanent 64px
rail.

**Auth split layout** (`src/app/(auth)/layout.tsx`): the dark brand panel with
the three-pillar pitch is `hidden` until `lg:flex` (1024px) — below that,
sign-in and register are single-column forms with just the brand lockup shown
inline. This is a full 44%-width panel disappearing at one breakpoint rather
than reflowing, which is a reasonable simplification for a two-panel marketing
layout but means there's a real gap between "phone" and "desktop" (roughly
640–1023px) where the brand pitch is invisible entirely.

**Kanban board** (`src/components/kanban/board.tsx`,
`src/components/kanban/column.tsx`): six fixed-width (`w-64`, 256px) columns
in a `flex gap-3 overflow-x-auto` row. The board does not reflow to fewer
columns or stack vertically at any width — narrow viewports get horizontal
scroll across all six stages instead. Combined with the keyboard-navigation gap
in §7.3, the Deals page is the weakest responsive/accessibility surface in the
app: it works, but only for a mouse or touch user with room to scroll
sideways.

**Landing page** (`src/app/page.tsx` and children): conventional single-column
mobile-first stacking with a `max-w-6xl` content rail, `sm:`-gated grid
columns in `feature-grid.tsx` (`sm:grid-cols-3`) and hero CTA buttons that go
full-width below `sm:` and inline at `sm:` and above — this is the most
conventionally responsive surface in the app, consistent with it being the
one page evaluated by visitors on arbitrary devices rather than by the
product's own logged-in users.

**Tables** (`src/components/ui/table.tsx`): every `Table` self-wraps in
`overflow-x-auto`, so wide tables (contacts, companies lists) scroll
horizontally rather than truncating or reflowing to cards on narrow screens —
functional but not a purpose-built mobile table pattern.

---

## 9. Landing page visual strategy

The landing page (`src/app/page.tsx`) is a single-scroll marketing page —
nav, hero, stack strip, feature grid, footer — that did not always exist:
`SAAS-READINESS.md` §2 records that `/` used to redirect straight to
`/login`, so anyone opening the deployed URL hit an auth wall with no
context. The page still prerenders as fully static (the code comment in
`page.tsx` notes signed-in visitors never reach it — `src/proxy.ts` redirects
them to `/dashboard` before the request gets this far).

### Theme-matched screenshots

The hero and feature-grid sections embed real product screenshots — the
actual dashboard and the actual kanban board, not mockups — captured by `npm
run capture:shots` and committed to `public/marketing/`. Each screenshot
exists in **two variants**, `-light.png` and `-dark.png`, and
`src/components/landing/product-shot.tsx` renders **both** simultaneously,
swapping visibility with the `dark:` Tailwind class variant (`dark:hidden` /
`hidden dark:block`) rather than a `<picture>` element keyed on
`prefers-color-scheme`.

The component's own comment explains why this is the correct choice and not
an oversight: because the app's theme source of truth is the `.dark` class set
by `theme-init.js` from `localStorage` (§2.3), not the OS media query, keying
the screenshot swap off `prefers-color-scheme` could show the *wrong* variant
— e.g. a visitor who chose dark mode while signed in, on a light-mode OS,
should see the dark screenshot on the signed-out landing page too, and a
`prefers-color-scheme` media query has no way to know that. The accepted cost
is that **both variants are actually fetched** — the hidden one is hidden with
a `dark:` CSS class, which does not prevent loading. `product-shot.tsx` states
this plainly: "The cost is the second variant being fetched. Both are served
resized by `next/image`, so it is a small fraction of the source PNG."

### Brand panel treatment

Both the landing hero and the sign-in split layout use the same radial-gradient
treatment — a soft violet glow anchored top-of-frame in the hero
(`radial-gradient(55% 40% at 50% 0%, rgba(124,58,237,0.16), transparent 70%)`)
and a two-point violet/cyan glow on the dark auth panel — tying the two entry
points (marketing page, sign-in page) to one consistent atmosphere without
using imagery. The `hero.tsx` code comment states this is deliberate: *"Same
radial treatment as the sign-in brand panel, kept subtle so the section reads
on both themes."*

---

## 10. Open questions

- **`--font-mono` (Geist Mono)** is declared as a theme token but no active
  usage was found in the components read for this brief — worth confirming
  whether it's genuinely unused or just not present in the files inspected.
- **`--chart-grid` / `--chart-axis`** use a warm-neutral hue family that
  doesn't match the cool-zinc neutrals used for `--edge` / `--ink-faint`
  elsewhere (§4). Nothing in the codebase comments on this; it reads as
  either an intentional "chart chrome is its own subsystem" choice or an
  unreconciled leftover from wherever the CVD-validated reference palette was
  sourced.
- Whether the **kanban keyboard-navigation gap** (§7.3) and the **kanban
  mobile-reflow gap** (§8) are planned to be fixed together (a keyboard
  affordance would likely also demand a non-drag "move to stage" menu, which
  would incidentally solve the mobile problem too) is not stated anywhere in
  the docs read for this brief.
