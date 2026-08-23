"use client";

import { useDroppable } from "@dnd-kit/core";
import { formatCompactCurrency, cn } from "@/lib/utils";
import { STAGE_PROBABILITY, type DealStage } from "@/lib/constants";
import { DealCard, type BoardDeal } from "./deal-card";

const stageDot: Record<DealStage, string> = {
  LEAD: "bg-zinc-400",
  QUALIFIED: "bg-indigo-500",
  PROPOSAL: "bg-amber-500",
  NEGOTIATION: "bg-orange-500",
  WON: "bg-emerald-500",
  LOST: "bg-rose-500",
};

export function KanbanColumn({
  stage,
  label,
  deals,
  onCardClick,
}: {
  stage: DealStage;
  label: string;
  deals: BoardDeal[];
  onCardClick: (deal: BoardDeal) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: stage });
  const total = deals.reduce((s, d) => s + d.value, 0);
  const probability = STAGE_PROBABILITY[stage];
  // Every card in a column shares a stage, so the column weight is one
  // multiply rather than a per-deal sum. Only worth showing while a deal
  // is still in play: at 100% it just repeats the total, and at 0% it is
  // always zero — both read as a bug rather than a forecast.
  const weighted = Math.round(total * probability);
  const showWeighted = probability > 0 && probability < 1;

  return (
    <div className="flex w-64 shrink-0 flex-col">
      <div className="mb-2 flex items-center gap-2 px-1">
        <span className={cn("h-2 w-2 rounded-full", stageDot[stage])} />
        <h3 className="text-[13px] font-semibold text-ink">{label}</h3>
        <span className="text-[12px] tabular-nums text-ink-faint">
          {deals.length}
        </span>
        <span
          className="ml-auto text-[12px] font-medium tabular-nums text-ink-faint"
          title={
            showWeighted
              ? `${formatCompactCurrency(total)} in ${label} · ${formatCompactCurrency(weighted)} weighted at ${Math.round(probability * 100)}%`
              : `${formatCompactCurrency(total)} in ${label}`
          }
        >
          {formatCompactCurrency(total)}
          {showWeighted ? (
            <span className="ml-1.5 text-ink-faint/70">
              {formatCompactCurrency(weighted)}
            </span>
          ) : null}
        </span>
      </div>
      <div
        ref={setNodeRef}
        // Named so a screen-reader user knows which stage they are in — which
        // matters now that a card can be carried between columns by keyboard.
        role="group"
        aria-label={`${label} deals`}
        className={cn(
          "flex min-h-40 flex-1 flex-col gap-2 rounded-xl border border-edge/70 bg-surface-2/50 p-2 transition-colors",
          isOver && "border-accent/40 bg-accent-soft/50",
        )}
      >
        {deals.map((deal) => (
          <DealCard key={deal.id} deal={deal} onClick={() => onCardClick(deal)} />
        ))}
        {deals.length === 0 ? (
          <p className="px-2 py-6 text-center text-[12px] text-ink-faint">
            Drop deals here
          </p>
        ) : null}
      </div>
    </div>
  );
}
