# Security design

What this project does to protect data, and the trade-offs it makes as a
free, self-hosted, single-instance app.

## Authentication & sessions

- **Passwords**: bcrypt with cost 12 (`src/lib/auth/password.ts`). Plain-text
  passwords never touch the database or logs.
- **Sessions**: 256-bit random tokens; only the **SHA-256 hash** is stored
  (`Session.tokenHash`), so a leaked database cannot be replayed as cookies.
- **Cookies**: `httpOnly`, `SameSite=Lax`, `Secure` in production, 30-day
  sliding expiry (renewed server-side when <15 days remain).
- **Timing-safe login**: unknown emails still run a bcrypt compare against a
  dummy hash, keeping response times uniform; failures return one generic
  message ("Invalid email or password").
- **Rate limiting**: login 100 attempts/15min per source address (every attempt, checked
  before the lookup and the bcrypt compare), 10 failures/15min per address+email and
  20 failures/15min per account; registration 5/15min per IP;
  AI actions 30/hour per user, global search 120/min per user (`src/lib/rate-limit.ts`).

## Authorization

- The proxy (`src/proxy.ts`) only checks cookie **presence** for fast
  redirects — the **authoritative** check is `getCurrentUser()`, which
  validates the token hash against the database; every app page, the app layout and
  **every server action** except `login`, `register` and `logout` reaches it through
  `requireWorkspacePage()` / `requireWorkspace()` (or `requireUser()` for the two
  actions that never touch the database), which also resolve the user's workspace
  from their membership. `login` and `register` run before there is a session, and
  `logout` calls `getCurrentUser()` directly so it can end one without throwing.
- Roles live on the workspace membership: `OWNER` / `ADMIN` / `MEMBER`.
  Destructive operations (deleting records you don't own) require ownership
  or a workspace admin (OWNER or ADMIN), and never reach another workspace.
- Every query application code makes runs through a client scoped to the
  signed-in user's workspace, which fails closed; an id from another workspace
  is "not found".
- In single mode (self-hosting, the public demo) the first registered account
  becomes the workspace owner and later accounts are members; in multi mode
  (the hosted cloud) every sign-up owns a private workspace.

## Input handling

- Every mutation parses input with **zod** (`src/lib/validation.ts`) —
  lengths, formats, enums — before touching the database.
- Prisma parameterizes every query. The one raw statement in the app is a
  constant `SELECT 1` liveness probe (`src/app/api/health/route.ts`) with no
  interpolation.
- React escapes output by default, and there is no `dangerouslySetInnerHTML`
  anywhere in the codebase — the theme script is an external file
  (`public/theme-init.js`) loaded with `next/script`, not inlined.
- Relation IDs coming from forms (`companyId`, `contactId`, `dealId`) are
  verified to exist server-side before linking, in every action that accepts
  one.
- AI-generated text is rendered as plain text, never as HTML or markdown, so
  model output has no path to the DOM.

## CSRF

Mutations go exclusively through **Server Actions**, which Next.js protects
with same-origin checks on the `Origin`/`Host` headers; `SameSite=Lax`
cookies add a second layer.

## Security headers

Set globally in `next.config.ts`: a Content-Security-Policy (no external
script/connect sources — AI providers are called **server-side only**),
`X-Frame-Options: DENY`, `nosniff`, a restrictive `Permissions-Policy` and
`Referrer-Policy`.

## AI-specific concerns

- **Prompt injection**: CRM notes/activities are user-controlled text that
  gets embedded in prompts. They are fenced inside `<record>` tags, pasted
  background inside `<user-context>` tags, and the system prompt instructs the
  model to treat both strictly as data and to take instructions only from
  outside those tags. The draft prompt additionally tells the model, above the
  `<user-context>` block, to ignore any sentence in it that addresses the model.
  Outputs are rendered as plain text (never HTML/markdown-executed). The fence
  and three named injection payloads are checked on every PR by the evaluation
  harness (`npm run eval`, `src/eval`), on the prompt itself and on the output;
  the honest limit remains that labelling reduces instruction-following, it does
  not prevent it.
- **Score integrity**: model responses are requested as JSON and must parse
  whole with a numeric 0–100 score (rounded to an integer) and a string reason,
  or they're discarded in favor of the deterministic heuristic, with the reason
  recorded in the audit entry.
- **Draft integrity**: a model draft must open with a `Subject:` line that has
  subject text and must carry a body, or it is discarded for the next provider
  and then the heuristic, with the reason (`malformed`) in the audit entry. This
  is shape, not content: an injected paragraph under a valid subject line is
  not caught here, and the harness's injection fixtures remain that check. Added
  after the Groq fallback returned an injected "maintenance mode" note as the
  draft on 2026-09-12 and obeyed it again on 2026-09-13.
- **Quota abuse**: per-user hourly rate limit on all AI actions; per-user per-minute
  limit on global search, whose results are capped at five per record type so a
  query can never pull a whole table.
- **Key handling**: API keys live in `.env` (gitignored) and are only read
  server-side; they never reach the client bundle.

## Auditability

`AuditLog` records all create/update/delete operations, stage changes and AI
usage — with actor, entity, timestamp and a JSON metadata snippet — against the
acting user's workspace. Sign-ups, sign-ins (including failures) and sign-outs
are platform events (`auth.*`): they are recorded with no workspace and never
appear in Settings, so nobody sees the address a failed sign-in came from.
Workspace admins can review the latest 25 events of their own workspace in
Settings.

## Known trade-offs (single-instance, free-tier scope)

| Trade-off | Why | Production path |
|---|---|---|
| In-memory rate limiter (per warm instance on serverless, so every cap is per instance; the bucket map is bounded at 10,000 entries, evicting unexhausted buckets before any lockout) | zero dependencies | Redis / DB-backed buckets |
| Open registration | demo convenience | invite-only flag |
| No password reset | needs an email provider | Resend/SES + signed tokens |
| No 2FA | scope | TOTP via otplib |
| SQLite file DB | free, local | Postgres + encrypted backups |
| Registration reveals taken emails | standard UX trade-off | queue + email verification |
