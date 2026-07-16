import { cn } from "@/lib/utils";
import type { ContactStatus, DealStage } from "@/lib/constants";

export function Badge({
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium leading-4",
        className,
      )}
      {...props}
    />
  );
}

const contactStatusStyles: Record<ContactStatus, string> = {
  LEAD: "bg-accent-soft text-accent border-accent/25",
  QUALIFIED: "bg-warn-soft text-warn border-warn/30",
  CUSTOMER: "bg-success-soft text-success border-success/30",
  CHURNED: "bg-surface-2 text-ink-faint border-edge-strong/60",
};

export function ContactStatusBadge({ status }: { status: string }) {
  const style =
    contactStatusStyles[status as ContactStatus] ?? contactStatusStyles.LEAD;
  return <Badge className={style}>{status.toLowerCase()}</Badge>;
}

const stageStyles: Record<DealStage, string> = {
  LEAD: "bg-surface-2 text-ink-muted border-edge-strong/60",
  QUALIFIED: "bg-accent-soft text-accent border-accent/25",
  PROPOSAL: "bg-warn-soft text-warn border-warn/30",
  NEGOTIATION: "bg-warn-soft text-warn border-warn/30",
  WON: "bg-success-soft text-success border-success/30",
  LOST: "bg-danger-soft text-danger border-danger/30",
};

export function StageBadge({ stage }: { stage: string }) {
  const style = stageStyles[stage as DealStage] ?? stageStyles.LEAD;
  return <Badge className={style}>{stage.toLowerCase()}</Badge>;
}
