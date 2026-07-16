import { cn } from "@/lib/utils";

/**
 * AI lead score 0–100. Thresholds: 70+ hot, 40–69 warm, <40 cold.
 * Color is never the only signal — the number is always shown.
 */
export function ScorePill({ score }: { score: number | null }) {
  if (score === null) {
    return <span className="text-[13px] text-ink-faint">—</span>;
  }
  const tone =
    score >= 70
      ? "bg-success-soft text-success border-success/30"
      : score >= 40
        ? "bg-warn-soft text-warn border-warn/30"
        : "bg-surface-2 text-ink-muted border-edge-strong/60";
  return (
    <span
      className={cn(
        "inline-flex min-w-9 items-center justify-center rounded-full border px-2 py-0.5 text-[12px] font-semibold tabular-nums",
        tone,
      )}
    >
      {score}
    </span>
  );
}
