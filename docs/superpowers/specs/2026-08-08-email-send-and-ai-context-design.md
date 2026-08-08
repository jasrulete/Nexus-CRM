# Sending follow-ups, and optional AI context — design

Date: 2026-08-08

## Problem

`draftFollowUp` produces a subject and body that the user has to copy by hand,
and the AI only ever sees stored records — there is no way to tell it something
it cannot infer.

## Feature A — send the draft

### Recipient is the signed-in user, never the contact

The demo is publicly linked with published credentials. A send-to-anyone button
turns it into a spam relay, which ends with the sending domain burned or the
provider account terminated. Forcing the recipient to the signed-in account's
own address removes that entirely: the worst a visitor can do is mail the demo
account.

The UI says **"Send to yourself"** rather than "Send". Labelling it "Send" would
imply the contact receives it, which is false.

### Behaviour

| Condition | Result |
|---|---|
| `RESEND_API_KEY` set, not the locked demo account | Real send to the signed-in user's address |
| `DEMO_MODE=true` and the demo account | Skipped, reported as simulated |
| No `RESEND_API_KEY` | Skipped, reported as not configured |

**An `EMAIL` Activity is logged on the contact in every case**, so the send lands
in the activity feed and the flow is visible in the demo even when nothing is
delivered. That is what makes the feature worth showing.

Rate limited with the existing `aiRateLimited` helper.

### Provider

`src/lib/email.ts` calls Resend's REST API with `fetch`, matching how
`src/lib/ai/provider.ts` already talks to Gemini and Groq. No new dependency.
Configured by `RESEND_API_KEY` and `EMAIL_FROM`; inert without them, like the AI
provider and Sentry.

Resend's free tier only delivers to the account's own signup address until a
domain is verified — which is exactly the recipient here, so no domain purchase
is needed.

## Feature B — optional context for the draft

A textarea in the AI panel, shown with the Draft action. Its contents are passed
to `draftFollowUp` and injected into the prompt inside a delimited block labelled
as background, not instructions: user text reaching an LLM prompt should not be
able to restyle the task. Capped at 2000 characters and validated with zod, like
every other input.

Not persisted. It applies to one generation, which is what was asked for. Score
and Summarize are untouched.

## Testing

- `src/lib/email.ts`: builds the expected Resend payload, and returns
  `skipped` with a reason when unconfigured.
- The demo/unconfigured gate on `sendFollowUp`.
- e2e: draft → send → the activity appears on the contact. This passes in CI
  with no API key because that is the skip path.

## Out of scope

File and document uploads, which need blob storage, parsing, size caps and their
own abuse controls for a public demo — a separate project. Sending to the
contact's real address. Persisting context between generations. Templates,
scheduling, and open/click tracking.
