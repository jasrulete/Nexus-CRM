"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Building2, CalendarDays, User } from "lucide-react";
import { cn, formatCurrency, formatDateOnly } from "@/lib/utils";

export type BoardDeal = {
  id: string;
  title: string;
  value: number;
  stage: string;
  position: number;
  expectedCloseDate: string | null;
  contactId: string | null;
  contactName: string | null;
  companyId: string | null;
  companyName: string | null;
};

export function DealCard({
  deal,
  overlay,
  onClick,
}: {
  deal: BoardDeal;
  overlay?: boolean;
  onClick?: () => void;
}) {
  const sortable = useSortable({ id: deal.id, disabled: overlay });
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    sortable;

  const overdue =
    deal.expectedCloseDate &&
    new Date(deal.expectedCloseDate) < new Date() &&
    !["WON", "LOST"].includes(deal.stage);

  return (
    <div
      ref={overlay ? undefined : setNodeRef}
      style={
        overlay
          ? undefined
          : { transform: CSS.Transform.toString(transform), transition }
      }
      {...(overlay ? {} : attributes)}
      {...(overlay ? {} : listeners)}
      onClick={onClick}
      className={cn(
        "cursor-grab rounded-lg border border-edge bg-surface p-3 shadow-[0_1px_2px_rgb(0_0_0/0.05)] transition-shadow",
        "hover:border-edge-strong hover:shadow-md",
        isDragging && "opacity-40",
        overlay && "rotate-2 shadow-xl ring-2 ring-accent/30 cursor-grabbing",
      )}
    >
      <p className="text-[13px] font-medium leading-5 text-ink">{deal.title}</p>
      <p className="mt-1 text-sm font-semibold tabular-nums text-ink">
        {formatCurrency(deal.value)}
      </p>
      <div className="mt-2 space-y-1">
        {deal.contactName ? (
          <p className="flex items-center gap-1.5 text-[12px] text-ink-faint">
            <User className="h-3 w-3" /> {deal.contactName}
          </p>
        ) : null}
        {deal.companyName ? (
          <p className="flex items-center gap-1.5 text-[12px] text-ink-faint">
            <Building2 className="h-3 w-3" /> {deal.companyName}
          </p>
        ) : null}
        {deal.expectedCloseDate ? (
          <p
            className={cn(
              "flex items-center gap-1.5 text-[12px]",
              overdue ? "font-medium text-danger" : "text-ink-faint",
            )}
          >
            <CalendarDays className="h-3 w-3" />
            {formatDateOnly(deal.expectedCloseDate)}
          </p>
        ) : null}
      </div>
    </div>
  );
}
