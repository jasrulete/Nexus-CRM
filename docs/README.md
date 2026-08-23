# Nexus CRM — documentation

Seven documents. Each was written by reading the code, then fact-checked against it; the
corrections from that pass are folded in. Where the code does something wrong or unfinished,
these documents say so rather than describing the version we wish existed.

| Document | Read it when you want to know… | Size |
|---|---|---|
| [GLOSSARY.md](GLOSSARY.md) | **Start here.** What every concept, file, function and env var means, and why it was chosen. Part 1 explains the general ideas (RSC, Server Actions, Prisma adapters, CSP, prompt injection…); Part 2 is this codebase's own vocabulary. Written for interview prep as much as for maintenance. | ~104 KB |
| [TECHNICAL-DESIGN.md](TECHNICAL-DESIGN.md) | How the system actually works end to end — the request lifecycle, auth, authorization, the database adapter switch, the AI layer, migrations, observability. Includes the architectural decision records and an honest "known weaknesses" section. | ~80 KB |
| [DATA-MODEL.md](DATA-MODEL.md) | Every table, column, relation, index and cascade rule, and why each is the way it is. Includes the modelling debts (enum-like strings with no DB constraint, the unread currency column, date-only comparisons). | ~48 KB |
| [USER-FLOWS.md](USER-FLOWS.md) | What happens when someone clicks something — every path through the app including the failure and permission-denied branches. | ~35 KB |
| [PRD.md](PRD.md) | What this product is for, who it serves, what is deliberately not built, and the acceptance criteria behind each feature. | ~43 KB |
| [DESIGN-BRIEF.md](DESIGN-BRIEF.md) | The design system as built: colour tokens, the light/dark mechanism, typography, components, accessibility commitments. | ~28 KB |
| [ENGINEERING-PLAN.md](ENGINEERING-PLAN.md) | What ships next and in what order, the standards this project holds itself to, and how to decide what *not* to build. | ~52 KB |

## Related documents outside this folder

- [`../SAAS-READINESS.md`](../SAAS-READINESS.md) — the running log of hardening passes, with every
  fix and the incident that prompted it. The most-read document in the repo after the README.
- [`../IMPROVEMENT-PLAN.md`](../IMPROVEMENT-PLAN.md) — the audit that produced the current
  workstream, with findings ranked and sequenced.
- [`../SECURITY.md`](../SECURITY.md) — the security posture, stated in checkable claims.
- [`superpowers/specs/`](superpowers/specs/) — design notes written before building specific
  features, kept as a record of the thinking at the time.

## A note on trusting these

Documentation that overstates is worse than none — it turns every known gap into a credibility
problem. This set was written by reading the source, then audited by a separate pass that
compared every checkable claim against the code. That pass found nine material errors, including
three documents independently describing the session "sliding renewal" as working when it does
not. Those are corrected, and the broken behaviour is now documented as broken.

If you find a claim here that the code contradicts, the code is right and the document is a bug.
