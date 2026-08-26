import { cn } from "@/lib/utils";
import { initials } from "@/lib/utils";

// Deterministic soft background per name so avatars are stable across renders.
//
// The text sits two steps darker than the obvious choice (-800, not -600): a
// -500 tint at 15% opacity is very close to the page background, so -600
// initials landed under 4.5:1. Caught by the axe check in
// e2e/accessibility.spec.ts, not by eye.
//
// All six move together even though they failed at different thresholds. The
// tint is chosen by hashing the name, so which one renders depends on which
// contact happens to be on screen — fixing only the ones a given test run
// exercised is how this stayed hidden through several runs. e2e asserts every
// tint, not whichever appeared.
//
// The element is aria-hidden and the initials only repeat the name beside them,
// so WCAG's decoration exemption could arguably be claimed instead. Making it
// readable for low-vision users is the better answer, and it keeps the check
// honest rather than suppressed.
const TINTS = [
  "bg-indigo-500/15 text-indigo-800 dark:text-indigo-300",
  "bg-sky-500/15 text-sky-800 dark:text-sky-300",
  "bg-emerald-500/15 text-emerald-800 dark:text-emerald-300",
  "bg-amber-500/15 text-amber-800 dark:text-amber-300",
  "bg-rose-500/15 text-rose-800 dark:text-rose-300",
  "bg-violet-500/15 text-violet-800 dark:text-violet-300",
];

function tintFor(name: string) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
  return TINTS[Math.abs(h) % TINTS.length];
}

export function Avatar({
  name,
  size = "md",
  className,
}: {
  name: string;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const sizes = {
    sm: "h-7 w-7 text-[11px]",
    md: "h-9 w-9 text-[13px]",
    lg: "h-12 w-12 text-base",
  };
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full font-semibold",
        sizes[size],
        tintFor(name),
        className,
      )}
    >
      {initials(name)}
    </span>
  );
}
