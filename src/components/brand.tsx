import { cn } from "@/lib/utils";

// The "nexus" mark: a hub node connected to satellites — a network of
// relationships, which is what the CRM manages. Uses currentColor so it
// inherits text-on-accent from the wrapper.
function NexusGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" fill="none" className={className} aria-hidden="true">
      <g stroke="currentColor" strokeWidth={2.2} strokeLinecap="round">
        <path d="M16 16 16 8" />
        <path d="M16 16 9 21.5" />
        <path d="M16 16 23 21.5" />
      </g>
      <g fill="currentColor">
        <circle cx="16" cy="16" r="3.2" />
        <circle cx="16" cy="8" r="2.4" />
        <circle cx="9" cy="21.5" r="2.4" />
        <circle cx="23" cy="21.5" r="2.4" />
      </g>
    </svg>
  );
}

export function BrandMark({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "relative inline-flex h-8 w-8 items-center justify-center rounded-lg bg-accent text-on-accent shadow-sm",
        className,
      )}
    >
      <NexusGlyph className="h-5 w-5" />
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
