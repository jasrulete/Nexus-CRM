import Link from "next/link";
import { cn } from "@/lib/utils";

/**
 * A URL-driven filter pill, so a filtered view stays shareable and
 * back-button-safe. Shared by the contacts and companies lists — copying it
 * had already produced two chips with different borders and hover states.
 */
export function FilterChip({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "rounded-full border px-3 py-1.5 text-[13px] font-medium transition-colors",
        active
          ? "border-accent/40 bg-accent-soft text-accent"
          : "border-edge-strong/60 bg-surface text-ink-muted hover:bg-surface-2",
      )}
    >
      {children}
    </Link>
  );
}
