"use server";

import { requireUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { rateLimit, sweepExpiredBuckets } from "@/lib/rate-limit";
import { searchQuerySchema } from "@/lib/validation";
import { fullName } from "@/lib/utils";
import { formatDealAmount } from "@/lib/money";
import {
  ACTIVITY_TYPE_LABELS,
  STAGE_LABELS,
  type ActivityType,
  type DealStage,
} from "@/lib/constants";
import {
  SEARCH_PER_KIND,
  activityHref,
  nameTerms,
  snippet,
  type SearchHit,
  type SearchResult,
} from "@/lib/search";

/**
 * The palette's one call: contacts, companies, deals and activity content in
 * a single round trip. A server action rather than a route handler because
 * every other data path here is one (TECHNICAL-DESIGN §4), the harness tests
 * this layer against real migrations, and POST-only results are never
 * URL-addressable or cached.
 */
export async function searchRecords(rawQuery: string): Promise<SearchResult> {
  const user = await requireUser();

  // Validate before charging the bucket: a rejected query costs nothing.
  const parsed = searchQuerySchema.safeParse(rawQuery);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Enter a search" };
  }
  const q = parsed.data;

  // The highest-frequency action in the app: one call per settled keystroke.
  // 120/min is two a second sustained — generous for a typist, a wall for a
  // script. Per-instance memory, like every bucket in rate-limit.ts: defence
  // in depth on Vercel, not a hard limit.
  sweepExpiredBuckets();
  const limited = rateLimit(`search:${user.id}`, { limit: 120, windowMs: 60_000 });
  if (!limited.ok) {
    return { ok: false, message: `Too many searches — try again in ${limited.retryAfterSec}s.` };
  }

  const name = nameTerms(q);
  // One extra row says "more exist" without a count() query.
  const take = SEARCH_PER_KIND + 1;

  /**
   * Bounded on purpose: SEARCH_PER_KIND rows per entity type, so at most
   * 4 × (SEARCH_PER_KIND + 1) rows leave the database per keystroke however
   * large the workspace gets. Every branch is a Prisma `contains`, which SQLite
   * runs as `LIKE '%q%'` — a full scan of the column, unindexable by
   * construction. Over Activity.content and the two notes columns that is fine
   * at demo scale and is the first thing to fall over at real scale: the cap
   * bounds the *result*, not the scan, and Turso bills scanned rows against
   * the free tier's row-read quota. The free upgrade path is SQLite FTS5 — a
   * virtual table over the searched columns, kept in step by triggers in one
   * migration, queried with MATCH (bm25 ranking for free) via $queryRaw.
   * better-sqlite3 and libSQL both ship it; no new service. Do that when a
   * search passes ~100 ms, not before.
   *
   * `%` and `_` in the query act as LIKE wildcards (no ESCAPE clause); worst
   * case is "everything matches", still capped. Reads are workspace-wide by
   * design — no ownerId filter, like every list page (DATA-MODEL, "Ownership
   * is authorization, not scoping").
   */
  const [contacts, companies, deals, activities] = await Promise.all([
    prisma.contact.findMany({
      where: {
        OR: [
          { firstName: { contains: q } },
          { lastName: { contains: q } },
          { email: { contains: q } },
          { title: { contains: q } },
          { notes: { contains: q } },
          ...(name
            ? [{ AND: [{ firstName: { contains: name[0] } }, { lastName: { contains: name[1] } }] }]
            : []),
        ],
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        title: true,
        email: true,
        company: { select: { name: true } },
      },
      orderBy: { updatedAt: "desc" },
      take,
    }),
    prisma.company.findMany({
      where: {
        OR: [
          { name: { contains: q } },
          { domain: { contains: q } },
          { industry: { contains: q } },
          { notes: { contains: q } },
        ],
      },
      select: { id: true, name: true, domain: true, industry: true },
      orderBy: { updatedAt: "desc" },
      take,
    }),
    prisma.deal.findMany({
      where: { title: { contains: q } },
      select: {
        id: true,
        title: true,
        stage: true,
        value: true,
        currency: true,
        baseValue: true,
        company: { select: { name: true } },
      },
      orderBy: { updatedAt: "desc" },
      take,
    }),
    prisma.activity.findMany({
      where: { content: { contains: q } },
      select: {
        id: true,
        type: true,
        content: true,
        contactId: true,
        dealId: true,
        companyId: true,
        contact: { select: { firstName: true, lastName: true } },
        deal: { select: { title: true } },
        company: { select: { name: true } },
      },
      orderBy: { createdAt: "desc" },
      take,
    }),
  ]);

  const truncated = [contacts, companies, deals, activities].some(
    (rows) => rows.length > SEARCH_PER_KIND,
  );
  const cut = <T,>(rows: T[]) => rows.slice(0, SEARCH_PER_KIND);

  // Fixed group order — the order "pull up Acme" means, and a shape a
  // screen-reader user learns once. Recency inside a group; no scoring, which
  // is what FTS5's bm25 provides later. A fake relevance is worse than none.
  const hits: SearchHit[] = [
    ...cut(contacts).map(
      (c): SearchHit => ({
        kind: "contact",
        id: c.id,
        href: `/contacts/${c.id}`,
        title: fullName(c),
        subtitle: [c.title, c.company?.name].filter(Boolean).join(" · ") || c.email,
      }),
    ),
    ...cut(companies).map(
      (c): SearchHit => ({
        kind: "company",
        id: c.id,
        href: `/companies/${c.id}`,
        title: c.name,
        subtitle: [c.domain, c.industry].filter(Boolean).join(" · ") || null,
      }),
    ),
    ...cut(deals).map(
      (d): SearchHit => ({
        kind: "deal",
        id: d.id,
        href: `/deals/${d.id}`,
        title: d.title,
        subtitle: `${STAGE_LABELS[d.stage as DealStage] ?? d.stage} · ${formatDealAmount(d)}${
          d.company ? ` · ${d.company.name}` : ""
        }`,
      }),
    ),
    ...cut(activities).map(
      (a): SearchHit => ({
        kind: "activity",
        id: a.id,
        href: activityHref(a),
        // Same priority as the href, so the title names the page the hit opens.
        title: `${ACTIVITY_TYPE_LABELS[a.type as ActivityType] ?? a.type} on ${
          a.deal?.title ?? (a.contact ? fullName(a.contact) : (a.company?.name ?? ""))
        }`,
        subtitle: snippet(a.content, q),
      }),
    ),
  ];

  return { ok: true, hits, truncated };
}
