"use client";

import { useState, useTransition } from "react";
import {
  Check,
  Copy,
  Gauge,
  Loader2,
  Mail,
  Sparkles,
} from "lucide-react";
import {
  draftFollowUp,
  scoreContact,
  summarizeContact,
  type AiActionResult,
} from "@/server/actions/ai";
import { Button } from "@/components/ui/button";
import { ScorePill } from "@/components/score-pill";

type Panel = "summary" | "email" | null;

export function AiPanel({
  contactId,
  score,
  scoreReason,
}: {
  contactId: string;
  score: number | null;
  scoreReason: string | null;
}) {
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [panel, setPanel] = useState<Panel>(null);
  const [result, setResult] = useState<AiActionResult | null>(null);
  const [copied, setCopied] = useState(false);

  function run(kind: "score" | "summary" | "email") {
    setBusy(kind);
    startTransition(async () => {
      try {
        if (kind === "score") {
          const r = await scoreContact(contactId);
          if (!r.ok) setResult(r);
          else setResult(null); // score renders from revalidated server data
          setPanel(null);
        } else {
          const r =
            kind === "summary"
              ? await summarizeContact(contactId)
              : await draftFollowUp(contactId);
          setResult(r);
          setPanel(kind === "summary" ? "summary" : "email");
        }
      } finally {
        setBusy(null);
      }
    });
  }

  async function copy() {
    if (!result?.text) return;
    await navigator.clipboard.writeText(result.text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  const providerLabel =
    result?.provider === "heuristic"
      ? "rule-based fallback (AI provider unavailable)"
      : result?.provider;

  return (
    <div className="space-y-4 px-5 pb-5">
      <div className="flex items-center justify-between rounded-lg border border-edge bg-surface-2/50 px-3.5 py-3">
        <div>
          <p className="text-[12px] font-medium text-ink-muted">Lead score</p>
          {scoreReason ? (
            <p className="mt-0.5 max-w-52 text-[12px] leading-4 text-ink-faint">
              {scoreReason}
            </p>
          ) : (
            <p className="mt-0.5 text-[12px] text-ink-faint">Not scored yet</p>
          )}
        </div>
        <ScorePill score={score} />
      </div>

      <div className="grid grid-cols-3 gap-2">
        <Button
          variant="secondary"
          size="sm"
          disabled={pending}
          onClick={() => run("score")}
          aria-label="Score this lead"
          className="flex-col gap-1 h-auto py-2.5"
        >
          {busy === "score" ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Gauge className="h-4 w-4 text-accent" />
          )}
          <span className="text-[12px]">Score</span>
        </Button>
        <Button
          variant="secondary"
          size="sm"
          disabled={pending}
          onClick={() => run("summary")}
          aria-label="Summarize this relationship"
          className="flex-col gap-1 h-auto py-2.5"
        >
          {busy === "summary" ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Sparkles className="h-4 w-4 text-accent" />
          )}
          <span className="text-[12px]">Summarize</span>
        </Button>
        <Button
          variant="secondary"
          size="sm"
          disabled={pending}
          onClick={() => run("email")}
          aria-label="Draft a follow-up email"
          className="flex-col gap-1 h-auto py-2.5"
        >
          {busy === "email" ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Mail className="h-4 w-4 text-accent" />
          )}
          <span className="text-[12px]">Draft email</span>
        </Button>
      </div>

      {result && !result.ok && result.message ? (
        <p className="rounded-lg border border-warn/30 bg-warn-soft px-3 py-2 text-[12px] text-warn">
          {result.message}
        </p>
      ) : null}

      {result?.ok && result.text && panel ? (
        <div className="rounded-lg border border-edge bg-surface-2/40">
          <div className="flex items-center justify-between border-b border-edge/60 px-3.5 py-2">
            <p className="text-[12px] font-medium text-ink-muted">
              {panel === "summary" ? "Relationship summary" : "Follow-up draft"}
            </p>
            {panel === "email" ? (
              <button
                onClick={copy}
                className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] font-medium text-ink-faint transition-colors hover:bg-surface-2 hover:text-ink cursor-pointer"
              >
                {copied ? (
                  <>
                    <Check className="h-3 w-3" /> Copied
                  </>
                ) : (
                  <>
                    <Copy className="h-3 w-3" /> Copy
                  </>
                )}
              </button>
            ) : null}
          </div>
          <pre className="whitespace-pre-wrap px-3.5 py-3 font-sans text-[13px] leading-5 text-ink">
            {result.text}
          </pre>
          <p className="border-t border-edge/60 px-3.5 py-1.5 text-[11px] text-ink-faint">
            Generated by {providerLabel}
          </p>
        </div>
      ) : null}
    </div>
  );
}
