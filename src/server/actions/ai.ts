"use server";

import { revalidatePath } from "next/cache";
import { audit } from "@/lib/audit";
import { requireUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import {
  heuristicEmailDraft,
  heuristicLeadScore,
  heuristicSummary,
} from "@/lib/ai/heuristics";
import { aiProviderName, extractJson, generateText } from "@/lib/ai/provider";
import { rateLimit } from "@/lib/rate-limit";
import { idSchema } from "@/lib/validation";

export type AiActionResult = {
  ok: boolean;
  text?: string;
  score?: number;
  reason?: string;
  provider: string;
  message?: string;
};

const OPEN_STAGES = ["LEAD", "QUALIFIED", "PROPOSAL", "NEGOTIATION"];

function aiRateLimited(userId: string) {
  // Protects free-tier API quotas: 30 AI calls per user per hour.
  return !rateLimit(`ai:${userId}`, { limit: 30, windowMs: 60 * 60_000 }).ok;
}

async function loadContactContext(contactId: string) {
  return prisma.contact.findUnique({
    where: { id: idSchema.parse(contactId) },
    include: {
      company: true,
      deals: { orderBy: { updatedAt: "desc" } },
      activities: { orderBy: { createdAt: "desc" }, take: 10, include: { user: true } },
    },
  });
}

function daysSince(date: Date | undefined | null): number | null {
  if (!date) return null;
  return Math.floor((Date.now() - date.getTime()) / 86400_000);
}

function recordBlock(contact: NonNullable<Awaited<ReturnType<typeof loadContactContext>>>) {
  const openDeals = contact.deals.filter((d) => OPEN_STAGES.includes(d.stage));
  return `<record>
Contact: ${contact.firstName} ${contact.lastName}
Title: ${contact.title ?? "unknown"}
Status: ${contact.status}
Source: ${contact.source ?? "unknown"}
Company: ${contact.company?.name ?? "none"} (${contact.company?.industry ?? "n/a"}, size ${contact.company?.size ?? "n/a"})
Notes: ${contact.notes ?? "none"}
Open deals: ${openDeals.map((d) => `"${d.title}" $${d.value} (${d.stage})`).join("; ") || "none"}
Won deals: ${contact.deals.filter((d) => d.stage === "WON").length}
Recent activity (newest first):
${contact.activities.map((a) => `- [${a.createdAt.toISOString().slice(0, 10)}] ${a.type}: ${a.content.slice(0, 300)}`).join("\n") || "- none"}
</record>`;
}

export async function scoreContact(contactId: string): Promise<AiActionResult> {
  const user = await requireUser();
  if (aiRateLimited(user.id)) {
    return { ok: false, provider: "none", message: "AI rate limit reached — try again later." };
  }

  const contact = await loadContactContext(contactId);
  if (!contact) return { ok: false, provider: "none", message: "Contact not found" };

  const openDeals = contact.deals.filter((d) => OPEN_STAGES.includes(d.stage));
  let score: number;
  let reason: string;
  let provider = "heuristic";

  const ai = await generateText(
    `${recordBlock(contact)}

Score this contact as a sales lead from 0 (cold) to 100 (hot).
Consider seniority, engagement recency, open pipeline, and fit signals in the notes.
Reply with ONLY a JSON object: {"score": <integer 0-100>, "reason": "<one sentence>"}`,
  );

  const parsed = ai
    ? extractJson<{ score: number; reason: string }>(ai.text)
    : null;

  if (
    parsed &&
    typeof parsed.score === "number" &&
    parsed.score >= 0 &&
    parsed.score <= 100 &&
    typeof parsed.reason === "string"
  ) {
    score = Math.round(parsed.score);
    reason = parsed.reason.slice(0, 500);
    provider = ai!.provider;
  } else {
    const h = heuristicLeadScore({
      status: contact.status,
      hasEmail: !!contact.email,
      hasPhone: !!contact.phone,
      hasCompany: !!contact.companyId,
      title: contact.title,
      source: contact.source,
      openDealCount: openDeals.length,
      openDealValue: openDeals.reduce((s, d) => s + d.value, 0),
      wonDealCount: contact.deals.filter((d) => d.stage === "WON").length,
      activityCount: contact.activities.length,
      daysSinceLastActivity: daysSince(contact.activities[0]?.createdAt),
    });
    score = h.score;
    reason = h.reason;
  }

  await prisma.contact.update({
    where: { id: contact.id },
    data: { aiScore: score, aiScoreReason: reason, aiScoredAt: new Date() },
  });
  await audit({
    action: "ai.score_contact",
    entityType: "contact",
    entityId: contact.id,
    userId: user.id,
    metadata: { score, provider },
  });

  revalidatePath(`/contacts/${contact.id}`);
  revalidatePath("/contacts");
  return { ok: true, score, reason, provider };
}

export async function draftFollowUp(contactId: string): Promise<AiActionResult> {
  const user = await requireUser();
  if (aiRateLimited(user.id)) {
    return { ok: false, provider: "none", message: "AI rate limit reached — try again later." };
  }

  const contact = await loadContactContext(contactId);
  if (!contact) return { ok: false, provider: "none", message: "Contact not found" };

  const ai = await generateText(
    `${recordBlock(contact)}

Write a short, warm follow-up email from ${user.name} to ${contact.firstName}.
Reference the most relevant open deal or recent conversation naturally.
Keep it under 130 words. Output format:
Subject: <subject line>

<email body>`,
  );

  if (ai) {
    await audit({
      action: "ai.draft_email",
      entityType: "contact",
      entityId: contact.id,
      userId: user.id,
      metadata: { provider: ai.provider },
    });
    return { ok: true, text: ai.text, provider: ai.provider };
  }

  const openDeal = contact.deals.find((d) => OPEN_STAGES.includes(d.stage));
  const text = heuristicEmailDraft({
    contactFirstName: contact.firstName,
    senderName: user.name,
    dealTitle: openDeal?.title ?? null,
    daysSinceLastActivity: daysSince(contact.activities[0]?.createdAt),
  });
  await audit({
    action: "ai.draft_email",
    entityType: "contact",
    entityId: contact.id,
    userId: user.id,
    metadata: { provider: "heuristic" },
  });
  return { ok: true, text, provider: "heuristic" };
}

export async function summarizeContact(contactId: string): Promise<AiActionResult> {
  const user = await requireUser();
  if (aiRateLimited(user.id)) {
    return { ok: false, provider: "none", message: "AI rate limit reached — try again later." };
  }

  const contact = await loadContactContext(contactId);
  if (!contact) return { ok: false, provider: "none", message: "Contact not found" };

  const ai = await generateText(
    `${recordBlock(contact)}

Summarize this relationship for an account executive who has 20 seconds:
current state, open pipeline, engagement trend, and the single best next step.
Use 3-4 short bullet points.`,
  );

  if (ai) {
    await audit({
      action: "ai.summarize_contact",
      entityType: "contact",
      entityId: contact.id,
      userId: user.id,
      metadata: { provider: ai.provider },
    });
    return { ok: true, text: ai.text, provider: ai.provider };
  }

  const openDeals = contact.deals.filter((d) => OPEN_STAGES.includes(d.stage));
  const text = heuristicSummary({
    name: `${contact.firstName} ${contact.lastName}`,
    status: contact.status,
    companyName: contact.company?.name ?? null,
    openDeals,
    recentActivities: contact.activities,
  });
  return { ok: true, text, provider: "heuristic" };
}

export async function currentAiProvider(): Promise<string> {
  await requireUser();
  return aiProviderName() ?? "heuristic";
}
