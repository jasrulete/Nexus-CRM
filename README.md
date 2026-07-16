# Nexus CRM

An AI-powered CRM built with Next.js — pipeline management, contacts, companies,
activity tracking and AI insights, self-hosted and **100% free to run**.

> **Demo login** (after seeding): `demo@nexuscrm.dev` / `demo-password-123`

## Features

**CRM core**
- 📇 Contacts & companies with search, status filters and rich detail pages
- 📊 Dashboard: open pipeline, win rate, revenue-won trend, pipeline by stage
- 🗂️ Drag-and-drop deal kanban across six stages with live column totals
- 📝 Activity timeline (notes, calls, emails, meetings) on every record
- ✅ Tasks with due dates, overdue highlighting and quick-add everywhere

**AI layer** (pluggable, free providers)
- 🎯 Lead scoring (0–100) with a human-readable explanation, saved to the record
- 🧠 One-click relationship summaries for account handoffs
- ✉️ Context-aware follow-up email drafts (references the open deal)
- 🔌 Works with **Google Gemini** or **Groq** free tiers — or falls back to
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
# or
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
| `npm run lint` | ESLint |

## Architecture notes

- **Server Actions everywhere** — no hand-rolled API routes; every mutation is
  validated with zod, authorized against the session, and audited.
- **Auth is hand-built on purpose** (portfolio project): DB-backed sessions
  with hashed tokens and sliding expiry. The proxy (`src/proxy.ts`) does
  optimistic cookie checks; real validation happens next to the data.
- **AI provider abstraction** (`src/lib/ai/provider.ts`): one `generateText()`
  entry point; swapping providers is an env var, not a refactor.
- **SQLite by design** — zero-dependency local dev. For multi-instance
  deployment, swap the Prisma datasource to Postgres (e.g. Neon/Supabase free
  tier) and replace the in-memory rate limiter with a durable store.

## Roadmap ideas

- Password reset + email verification (needs an email provider)
- Team invitations & per-record sharing controls
- Import/export (CSV), webhooks, public API
- Retrieval-augmented "ask your CRM" search over notes and activities
