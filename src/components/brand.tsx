import { Hexagon } from "lucide-react";
import { cn } from "@/lib/utils";

export function BrandMark({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "relative inline-flex h-8 w-8 items-center justify-center rounded-lg bg-accent text-on-accent shadow-sm",
        className,
      )}
    >
      <Hexagon className="h-4.5 w-4.5" strokeWidth={2.2} />
    </span>
  );
}

export function BrandLockup({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <BrandMark />
      <span className="text-[15px] font-semibold tracking-tight text-ink">
        Nexus CRM
      </span>
    </span>
  );
}
