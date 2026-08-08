"use client";

import { useState, useTransition } from "react";
import {
  Check,
  Copy,
  Gauge,
  Loader2,
  Mail,
  Paperclip,
  Send,
  Sparkles,
  X,
} from "lucide-react";
import {
  draftFollowUp,
  extractFileText,
  scoreContact,
  sendFollowUp,
  summarizeContact,
  type AiActionResult,
} from "@/server/actions/ai";
import type { FileContext } from "@/lib/file-context";
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
  const [context, setContext] = useState("");
  const [showContext, setShowContext] = useState(false);
  const [sent, setSent] = useState<string | null>(null);
  const [file, setFile] = useState<FileContext | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);

  function pickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const chosen = e.target.files?.[0];
    e.target.value = ""; // let the same file be re-picked after removing it
    if (!chosen) return;

    setFileError(null);
    setBusy("file");
    startTransition(async () => {
      try {
        const data = new FormData();
        data.set("file", chosen);
        const r = await extractFileText(data);
        if (r.ok) setFile(r.file);
        else setFileError(r.message);
      } finally {
        setBusy(null);
      }
    });
  }

  function run(kind: "score" | "summary" | "email") {
    setBusy(kind);
    setSent(null);
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
              : await draftFollowUp(
                  contactId,
                  context.trim() || undefined,
                  file ?? undefined,
                );
          setResult(r);
          setPanel(kind === "summary" ? "summary" : "email");
        }
      } finally {
        setBusy(null);
      }
    });
  }

  function send() {
    if (!result?.text) return;
    setBusy("send");
    startTransition(async () => {
      try {
        const r = await sendFollowUp(contactId, result.text!);
        setSent(r.message ?? null);
        if (!r.ok) setResult(r);
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

      <div>
        <button
          type="button"
          onClick={() => setShowContext((v) => !v)}
          className="text-[12px] font-medium text-ink-faint transition-colors hover:text-ink cursor-pointer"
          aria-expanded={showContext}
        >
          {showContext ? "− Hide extra context" : "+ Add context for the draft"}
        </button>
        {showContext ? (
          <div className="mt-2">
            <label htmlFor="ai-context" className="sr-only">
              Extra context for the draft
            </label>
            <textarea
              id="ai-context"
              value={context}
              onChange={(e) => setContext(e.target.value.slice(0, 2000))}
              rows={3}
              placeholder="Anything the record doesn't say — e.g. they just raised a round, keep it brief."
              className="w-full rounded-lg border border-edge bg-surface px-3 py-2 text-[13px] text-ink placeholder:text-ink-faint focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
            />
            <p className="mt-1 text-[11px] text-ink-faint">
              {context.length}/2000 · used for the next draft only, not saved
            </p>

            <div className="mt-2.5">
              {file ? (
                <div className="flex items-center justify-between gap-2 rounded-lg border border-edge bg-surface px-2.5 py-1.5">
                  <span className="min-w-0 truncate text-[12px] text-ink">
                    <Paperclip className="mr-1 inline h-3 w-3 text-ink-faint" />
                    {file.name}
                    <span className="text-ink-faint">
                      {" "}
                      · {file.text.length.toLocaleString()} chars
                      {file.truncated ? " (truncated)" : ""}
                    </span>
                  </span>
                  <button
                    type="button"
                    onClick={() => setFile(null)}
                    aria-label="Remove attached file"
                    className="shrink-0 rounded p-0.5 text-ink-faint transition-colors hover:text-ink cursor-pointer"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ) : (
                <label className="inline-flex cursor-pointer items-center gap-1.5 text-[12px] font-medium text-ink-faint transition-colors hover:text-ink">
                  {busy === "file" ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Paperclip className="h-3.5 w-3.5" />
                  )}
                  Attach a PDF or text file
                  <input
                    type="file"
                    accept=".pdf,.txt,.md,application/pdf,text/plain,text/markdown"
                    onChange={pickFile}
                    disabled={pending}
                    className="sr-only"
                    aria-label="Attach a PDF or text file"
                  />
                </label>
              )}
              {fileError ? (
                <p className="mt-1 text-[11px] text-danger">{fileError}</p>
              ) : null}
              {/* The file is parsed and dropped — but its text still leaves the
                  app, which the user should know before attaching. */}
              <p className="mt-1 text-[11px] text-ink-faint">
                Read once for the draft and never stored. Its text is sent to the
                AI provider.
              </p>
            </div>
          </div>
        ) : null}
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
          {panel === "email" ? (
            <div className="border-t border-edge/60 px-3.5 py-2.5">
              <Button
                variant="secondary"
                size="sm"
                disabled={pending}
                onClick={send}
                aria-label="Send this draft to your own inbox"
              >
                {busy === "send" ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Send className="h-3.5 w-3.5" />
                )}
                Send to yourself
              </Button>
              {/* Deliberately not "Send" — the draft goes to the signed-in
                  user, never to the contact. Wording kept distinct from the
                  result message below so each is unambiguous to read (and to
                  assert on). */}
              <p className="mt-1.5 text-[11px] leading-4 text-ink-faint">
                Goes to your own inbox, not the contact.
              </p>
              {sent ? (
                <p className="mt-1.5 text-[11px] leading-4 text-success">
                  {sent}
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
