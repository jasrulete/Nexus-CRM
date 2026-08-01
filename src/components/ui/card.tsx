import { cn } from "@/lib/utils";

export function Card({
  className,
  interactive = false,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & {
  /** Adds a hover lift. Pair with `group-hover:` on children for accents. */
  interactive?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-xl border border-edge bg-surface shadow-[0_1px_2px_rgb(0_0_0/0.04)]",
        interactive && [
          "group transition-[transform,box-shadow,border-color] duration-200",
          "hover:-translate-y-0.5 hover:border-edge-strong",
          "hover:shadow-[0_6px_16px_rgb(0_0_0/0.08)]",
          // Respect users who ask for less movement; the border and shadow
          // still respond, so the affordance survives.
          "motion-reduce:transition-none motion-reduce:hover:translate-y-0",
        ],
        className,
      )}
      {...props}
    />
  );
}

export function CardHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 px-5 pt-4 pb-3">
      <div>
        <h2 className="text-sm font-semibold text-ink">{title}</h2>
        {subtitle ? (
          <p className="mt-0.5 text-[13px] text-ink-faint">{subtitle}</p>
        ) : null}
      </div>
      {action}
    </div>
  );
}
