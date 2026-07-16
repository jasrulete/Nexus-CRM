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
- **Rate limiting**: login 10/15min per IP+email, registration 5/15min per IP,
  AI actions 30/hour per user (`src/lib/rate-limit.ts`).

## Authorization

- The proxy (`src/proxy.ts`) only checks cookie **presence** for fast
  redirects — the **authoritative** check is `getCurrentUser()` /
  `requireUser()` which validates the token hash against the database in the
  app layout and inside **every server action**.
- Roles: `ADMIN` / `MEMBER`. Destructive operations (deleting records you
  don't own) require ownership or admin.
- The first registered account becomes admin; later accounts are members.

## Input handling

- Every mutation parses input with **zod** (`src/lib/validation.ts`) —
  lengths, formats, enums — before touching the database.
- Prisma parameterizes all queries (no raw SQL anywhere).
- React escapes output by default; the only `dangerouslySetInnerHTML` is a
  static, constant theme-init script.
- Relation IDs coming from forms (`companyId`, `contactId`) are verified to
  exist server-side before linking.

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
  gets embedded in prompts. They are fenced inside `<record>` tags and the
  system prompt instructs the model to treat that content strictly as data.
  Outputs are rendered as plain text (never HTML/markdown-executed).
- **Score integrity**: model responses must parse as JSON with a 0–100
  integer or they're discarded in favor of the deterministic heuristic.
- **Quota abuse**: per-user hourly rate limit on all AI actions.
- **Key handling**: API keys live in `.env` (gitignored) and are only read
  server-side; they never reach the client bundle.

## Auditability

`AuditLog` records logins (including failures), logouts, registrations, all
create/update/delete operations, stage changes and AI usage — with actor,
entity, timestamp and a JSON metadata snippet. Admins can review the latest
events in Settings.

## Known trade-offs (single-instance, free-tier scope)

| Trade-off | Why | Production path |
|---|---|---|
| In-memory rate limiter | zero dependencies | Redis / DB-backed buckets |
| Open registration | demo convenience | invite-only flag |
| No password reset | needs an email provider | Resend/SES + signed tokens |
| No 2FA | scope | TOTP via otplib |
| SQLite file DB | free, local | Postgres + encrypted backups |
| Registration reveals taken emails | standard UX trade-off | queue + email verification |
