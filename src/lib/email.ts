/**
 * Outbound email via Resend's REST API.
 *
 * Called with fetch rather than the SDK, matching how src/lib/ai/provider.ts
 * talks to Gemini and Groq — one less dependency for one HTTP call.
 *
 * Inert without RESEND_API_KEY, like the AI provider and Sentry: a clone with
 * no account still runs, and callers get a reason rather than a thrown error.
 */
export type SendResult =
  | { sent: true }
  | { sent: false; reason: "not-configured" | "failed"; detail?: string };

export function emailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);
}

export async function sendEmail({
  to,
  subject,
  text,
}: {
  to: string;
  subject: string;
  text: string;
}): Promise<SendResult> {
  if (!emailConfigured()) return { sent: false, reason: "not-configured" };

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: process.env.EMAIL_FROM,
        to: [to],
        subject,
        text,
      }),
    });

    if (!res.ok) {
      // Resend's body explains refusals worth acting on — an unverified domain,
      // or the free tier's "only your own address" rule.
      const detail = (await res.text()).slice(0, 200);
      return { sent: false, reason: "failed", detail };
    }
    return { sent: true };
  } catch (e) {
    return { sent: false, reason: "failed", detail: String(e).slice(0, 200) };
  }
}

/** Splits "Subject: x\n\nbody" — the shape draftFollowUp asks the model for. */
export function splitDraft(draft: string): { subject: string; body: string } {
  const match = draft.match(/^\s*Subject:\s*(.+?)\s*\n([\s\S]*)$/);
  if (!match) return { subject: "Following up", body: draft.trim() };
  return { subject: match[1]!.trim(), body: match[2]!.trim() };
}
