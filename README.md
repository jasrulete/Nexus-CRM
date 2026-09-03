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
- Role-based access (admin/member), full audit log, strict security headers

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
the workspace admin**.

### Enabling real AI (optional, still free)

Copy `.env.example` to `.env` and add **one** key:

```bash
GEMINI_API_KEY=...   # https://aistudio.google.com/apikey
# and/or — with both set, Groq takes over whenever Gemini fails
GROQ_API_KEY=...     # https://console.groq.com/keys
```

Restart the dev server. The Settings page shows which provider is active.
Without a key, AI features run in deterministic rule-based mode and are labeled
as such in the UI.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Start the dev server |
| `npm run build` / `start` | Production build / serve |
| `npm run db:migrate` | Apply schema migrations |
| `npm run db:seed` | Seed the demo workspace (idempotent) |
| `npm run typecheck` | TypeScript check |
| `npm test` | Unit tests (vitest) — scoring heuristics, validation, rate limiting |
| `npm run test:e2e` | End-to-end tests (Playwright) — auth, CRM flows, health |
| `npm run lint` | ESLint |

## Architecture notes

- **Server Actions everywhere** — no hand-rolled API routes; every mutation is
  validated with zod, authorized against the session, and audited.
- **Auth is hand-built on purpose** (portfolio project): DB-backed sessions
  with hashed tokens and sliding expiry. The proxy (`src/proxy.ts`) does
  optimistic cookie checks; real validation happens next to the data.
- **AI provider abstraction** (`src/lib/ai/provider.ts`): one `generateText()`
  entry point; swapping providers is an env var, not a refactor.
- **SQLite by design** — zero-dependency local dev; the same schema runs on
  Turso (libSQL) in production via a driver-adapter switch in
  `src/lib/db-adapter.ts`. For heavy multi-instance use, also move the
  in-memory rate limiter to a durable store.

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
  first account you register becomes the workspace admin.
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
   variables **scoped to Production** (plus `GEMINI_API_KEY` or `GROQ_API_KEY`
   if you want live AI, and `DEMO_MODE=true` if the deployment is a public demo).
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
