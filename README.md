# Nexus CRM

[![CI](https://github.com/jasrulete/Nexus-CRM/actions/workflows/ci.yml/badge.svg)](https://github.com/jasrulete/Nexus-CRM/actions/workflows/ci.yml)

An AI-powered CRM built with Next.js — pipeline management, contacts, companies,
activity tracking and AI insights, self-hosted and **100% free to run**.

**🔗 Live demo: [nexus-crm-jer2x.vercel.app](https://nexus-crm-jer2x.vercel.app/)** —
click **"Try the demo"** on the sign-in page for a one-click seeded workspace.

**Demo accounts** (after seeding):

| Role | Email | Password |
| --- | --- | --- |
| Admin (also the one-click **Try the demo** button) | `demo@nexuscrm.dev` | `demo-password-123` |
| Member (reduced permissions) | `member@nexuscrm.dev` | `member-password-123` |

The admin account is created by `npm run db:seed`, which always targets the
**local** database — seeding the hosted one requires `SEED_REMOTE=true`, so a
routine local seed can't write demo data into production. Add the member account
with `npm run db:add-member`.

Also by the same author: **[NVT Ops Suite](https://jasrulete.github.io/nvt-ops-suite/)** —
five zero-dependency concept apps for offshore staffing / EOR operations.

## Features

**CRM core**
- 📇 Contacts & companies with server-side search, filters and rich detail pages
- ⌘K global search across contacts, companies, deals and notes — server-filtered, keyboard-first
- 📊 Dashboard: open pipeline, weighted forecast, win rate, revenue-won trend, pipeline by stage
- 🗂️ Drag-and-drop deal kanban across six stages with live column totals
- 📝 Activity timeline (notes, calls, emails, meetings) on every record
- ✅ Tasks with due dates, overdue highlighting and quick-add everywhere

**AI layer** (pluggable, free providers)
- 🎯 Lead scoring (0–100) with a human-readable explanation, saved to the record
- 🧠 One-click relationship summaries for account handoffs
- ✉️ Context-aware follow-up email drafts (references the open deal)
- 🔌 Works with **Google Gemini** and/or **Groq** free tiers — set both and
  Groq takes over when Gemini's daily quota runs out — or falls back to
  honest, clearly-labeled rule-based heuristics with **no API key at all**
- 🛡️ CRM record data is fenced in `<record>` tags and treated as data, not
  instructions (prompt-injection mitigation); AI calls are rate-limited per user

**Security** (see [SECURITY.md](SECURITY.md))
- bcrypt-hashed passwords, server-side sessions stored as SHA-256 hashes
- httpOnly / SameSite cookies, login rate limiting, timing-safe login flow
- zod validation + server-side authorization on every mutation
- Workspace isolation, role-based access (owner/admin/member), full audit log, strict security headers

## Stack

| Layer | Choice | Cost |
|---|---|---|
| Framework | Next.js 16 (App Router, Server Actions) | free |
| Database | SQLite via Prisma 7 (driver adapters) | free |
| Styling | Tailwind CSS v4, Radix UI primitives, lucide icons | free |
| Charts | Recharts with a CVD-validated palette | free |
| Drag & drop | dnd-kit | free |
| AI | Gemini / Groq free tier, heuristic fallback | free |

## Getting started

```bash
npm install
npx prisma migrate dev   # creates dev.db
npm run db:seed          # demo workspace + login
npm run dev              # http://localhost:3000
```

Sign in with the demo account above, or register — the **first account becomes
the workspace owner**.

### Enabling real AI (optional, still free)

Copy `.env.example` to `.env` and add **one** key:

```bash
GEMINI_API_KEY=...   # https://aistudio.google.com/apikey
# and/or — with both set, Groq takes over whenever Gemini fails
GROQ_API_KEY=...     # https://console.groq.com/keys
```

Restart the dev server. The Settings page shows which provider is tried first and which takes over.
Without a key, AI features run in deterministic rule-based mode and are labeled
as such in the UI; when a key is set but its provider is rate-limited or down, the
label says that instead, so a quiet outage never reads like a fresh install.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Start the dev server |
| `npm run build` / `start` | Production build / serve |
| `npm run db:migrate` | Apply schema migrations |
| `npm run db:seed` | Seed the demo workspace (idempotent) |
| `npm run typecheck` | TypeScript check |
| `npm test` | Unit tests (vitest) — scoring heuristics, validation, rate limiting |
| `npm run test:e2e` | End-to-end tests (Playwright) — auth, CRM flows, health, and workspace isolation in multi mode (that project runs in CI, or locally with `E2E_MULTI=1` after a build — see `playwright.config.ts`) |
| `npm run eval` | AI evaluation harness — fixture contacts through the real actions with property assertions and three prompt-injection payloads; keyless by default, `EVAL_LIVE=1` for the real providers (live, an unreachable provider is retried once then skipped, so only the model misbehaving turns it red) |
| `npm run lint` | ESLint |

## Architecture notes

- **Server Actions everywhere** — no hand-rolled API routes; every mutation is
  validated with zod, authorized against the session, and audited.
- **Workspaces** — every CRM row carries a `workspaceId`, and application code
  only ever holds a client scoped to the signed-in user's workspace
  (`src/lib/tenancy.ts`). It fails closed: raw SQL, account tables and unknown
  operations through it throw. A test suite calls every server action and page
  loader as one workspace with another's ids. See [Workspace modes](#workspace-modes).
- **Auth is hand-built on purpose** (portfolio project): DB-backed sessions
  with hashed tokens and sliding expiry. The proxy (`src/proxy.ts`) does
  optimistic cookie checks; real validation happens next to the data.
- **AI provider abstraction** (`src/lib/ai/provider.ts`): three entry points,
  `generateText()` for text, `generateDraft()` for an email whose shape is
  checked before it is shown, and `generateJson()` for a schema-validated object,
  over one fallback chain; swapping providers is an env var, not a refactor.
- **SQLite by design** — zero-dependency local dev; the same schema runs on
  Turso (libSQL) in production via a driver-adapter switch in
  `src/lib/db-adapter.ts`. For heavy multi-instance use, also move the
  in-memory rate limiter to a durable store.

## Workspace modes

One codebase, two ways to run it, chosen by `WORKSPACE_MODE`:

| Mode | Who runs it | What it does |
|---|---|---|
| `single` | Self-hosters and the public demo | One workspace. The first account to register becomes its **owner**; everyone who registers after joins it as a member. Plan limits are off — self-hosting is free and unlimited. |
| `multi` | The hosted cloud plan | Every sign-up gets a private workspace on the free plan: 1 member, 200 contacts, 100 companies, 100 deals and 30 AI actions a month. No workspace can read or change another's data. |

`WORKSPACE_MODE` is **required in production**: with `NODE_ENV=production` and no
value the app refuses to boot, so a deployment that lost the variable can never
silently change mode. Development defaults to `single`. The Docker image sets
`single` for you; on Vercel or any other host, set it yourself.

| Variable | Default | Effect |
|---|---|---|
| `WORKSPACE_MODE` | `single` in development; **required** in production | `single` or `multi`, as above. `multi` refuses to boot with `DEMO_MODE=true` |
| `AI_DAILY_CEILING` | unset (no ceiling) | Deployment-wide cap on AI actions per UTC day, across all workspaces. At the cap, AI features answer in rule-based mode, labelled "daily AI capacity reached" |
| `SEED_DEMO_WORKSPACE` | unset | `true` marks the seeded workspace as the demo, the only thing that lets the nightly reset rebuild it. For the public demo's database only — never set it on a real install |

The seed and reset scripts (`db:seed`, `db:add-member`, `demo:reset`) refuse to
run in `multi` mode.

**AI keys on the hosted cloud:** set `GROQ_API_KEY` only. Gemini's free-tier
terms forbid sending personal information, and every cloud workspace holds real
contacts. The demo keeps both keys, because its data is invented.

## 🐳 Self-host with Docker

The whole app — server, SQLite database, demo data — runs from one command:

```bash
docker compose up -d --build   # → http://localhost:3000
```

On first boot the container applies the schema migrations and seeds the demo
workspace (both idempotent), so you can sign in straight away with the demo
account above.

- **Data** lives in the `nexus-data` named volume, mounted at `/data` inside
  the container (`DATABASE_URL=file:/data/nexus.db`). It survives rebuilds
  and restarts; `docker compose down -v` deletes it.
- **Seeding** is controlled by `SEED_DEMO_DATA: "true"` in
  `docker-compose.yml`. Remove that line to start with an empty CRM — the
  first account you register becomes the workspace owner. The seed is not
  atomic: if the first boot is killed partway through it, the next boot sees the
  demo account and skips, which leaves a partial demo — start again from an empty
  volume (`docker compose down -v`).
- **Workspace mode**: the image sets `WORKSPACE_MODE=single` — one workspace
  that everyone who registers joins. Leave it as it is; `multi` is for the
  hosted cloud.
- **Env vars**: add `GEMINI_API_KEY` or `GROQ_API_KEY` under `environment:`
  for live AI (optional — see `.env.example`). Your local `.env` is never
  copied into the image.

The image is a multi-stage build on `node:22-alpine` that ships only the
Next.js standalone output and runs as the unprivileged `node` user.

## Deploying to Vercel (free)

Vercel's serverless filesystem can't host the SQLite file, so production uses
[Turso](https://turso.tech) — SQLite-compatible, free tier, zero schema changes:

1. Create a Turso database and copy its URL + auth token.
2. Locally, put `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` in `.env`, then:
   ```bash
   npm run db:push:turso            # apply pending migrations (tracked in _turso_migrations)
   SEED_REMOTE=true npm run db:seed # optional demo data
   ```
   Re-run `db:push:turso` after every new migration — it applies only what the
   remote database is missing.
3. In Vercel → Project → Settings → Environment Variables, add the same two
   variables **scoped to Production**, plus `WORKSPACE_MODE=single` (required:
   the app refuses to boot in production without it), `GEMINI_API_KEY` or
   `GROQ_API_KEY` if you want live AI, and `DEMO_MODE=true` if the deployment is
   a public demo.
4. Push to GitHub — Vercel builds and deploys. The `postinstall` script runs
   `prisma generate`, and the app picks Turso automatically in Production.

Only a **Production** deployment gets the database implicitly. A preview
deployment refuses it and fails to build, on purpose — otherwise every
feature-branch preview would be a fully-privileged console onto live data, and
`DEMO_MODE` is not set outside Production so the delete-lock would be inert
there too. To make previews work, give them their own Turso database: the
step-by-step is in [SAAS-READINESS.md §4a](SAAS-READINESS.md).

## Roadmap ideas

- Password reset + email verification (needs an email provider)
- Team invitations & per-record sharing controls
- Import/export (CSV), webhooks, public API
- Retrieval-augmented "ask your CRM" search over notes and activities

## License

[MIT](LICENSE) © Jeric Rulete — clone it, self-host it, learn from it.

`package.json` stays `"private": true` deliberately: this is an application,
not a publishable package, and that flag is the only thing standing between a
stray `npm publish` and the registry. It does not restrict what you may do with
the code — the licence above governs that.
