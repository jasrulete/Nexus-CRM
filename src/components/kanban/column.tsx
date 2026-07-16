"use client";

import { useDroppable } from "@dnd-kit/core";
import { formatCompactCurrency, cn } from "@/lib/utils";
import type { DealStage } from "@/lib/constants";
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

  return (
    <div className="flex w-64 shrink-0 flex-col">
      <div className="mb-2 flex items-center gap-2 px-1">
        <span className={cn("h-2 w-2 rounded-full", stageDot[stage])} />
        <h3 className="text-[13px] font-semibold text-ink">{label}</h3>
        <span className="text-[12px] tabular-nums text-ink-faint">
          {deals.length}
        </span>
        <span className="ml-auto text-[12px] font-medium tabular-nums text-ink-faint">
          {formatCompactCurrency(total)}
        </span>
      </div>
      <div
        ref={setNodeRef}
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
