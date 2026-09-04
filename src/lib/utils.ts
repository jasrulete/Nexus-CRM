import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { WORKSPACE_CURRENCY } from "./money";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Both formatters default to the workspace currency, which is the only
// currency an aggregate can be in — every sum in the app is over baseValue.
// They defaulted to a literal "USD" while formatDealAmount in money.ts read
// WORKSPACE_CURRENCY, which was two answers to "what currency is this number":
// a self-hoster setting WORKSPACE_CURRENCY=EUR would have seen EUR on every deal
// card and a dollar sign on every total.
export function formatCurrency(value: number, currency = WORKSPACE_CURRENCY) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(value);
}

export function formatCompactCurrency(value: number, currency = WORKSPACE_CURRENCY) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    notation: "compact",
    // minimumFractionDigits is load-bearing, not decoration. With only a
    // maximum set, Node's ICU renders 61000 as "$61.0K" while Chrome renders
    // "$61K" — the spec leaves the trailing zero to the implementation. The
    // kanban column headers are server-rendered, so that disagreement was a
    // hydration mismatch on every /deals load: React discarded the server HTML
    // and rebuilt the whole board on the client, which also destroyed keyboard
    // focus and made the board unusable without a mouse.
    minimumFractionDigits: 0,
    maximumFractionDigits: 1,
  }).format(value);
}

export function formatDate(date: Date | string | null | undefined) {
  if (!date) return "—";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(date));
}

/**
 * For date-only fields (due dates, expected close dates) stored at UTC
 * midnight — rendering them in local time would shift the day.
 */
export function formatDateOnly(date: Date | string | null | undefined) {
  if (!date) return "—";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(date));
}

/**
 * Is a date-only value in the past?
 *
 * Date-only fields (`Task.dueDate`, `Deal.expectedCloseDate`) are stored at UTC
 * midnight and rendered with `formatDateOnly`, which pins timeZone: "UTC". The
 * comparison has to use the same frame, or the label and the styling disagree:
 * comparing against a raw `new Date()` made a task go red the moment UTC ticked
 * past midnight, which is the *previous evening* anywhere west of Greenwich —
 * so a task due "Aug 22, 2026" rendered as overdue from 8pm on the 21st, while
 * still displaying Aug 22.
 *
 * Compares whole UTC days, so a date is overdue only once the UTC day is past.
 */
export function isOverdueDateOnly(
  date: Date | string | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!date) return false;
  const due = new Date(date);
  if (Number.isNaN(due.getTime())) return false;
  const todayUtcMidnight = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  );
  return due.getTime() < todayUtcMidnight;
}

const RELATIVE_UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 1000 * 60 * 60 * 24 * 365],
  ["month", 1000 * 60 * 60 * 24 * 30],
  ["week", 1000 * 60 * 60 * 24 * 7],
  ["day", 1000 * 60 * 60 * 24],
  ["hour", 1000 * 60 * 60],
  ["minute", 1000 * 60],
];

export function timeAgo(date: Date | string) {
  const diff = new Date(date).getTime() - Date.now();
  const rtf = new Intl.RelativeTimeFormat("en-US", { numeric: "auto" });
  for (const [unit, ms] of RELATIVE_UNITS) {
    if (Math.abs(diff) >= ms) return rtf.format(Math.round(diff / ms), unit);
  }
  return "just now";
}

export function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");
}

export function fullName(c: { firstName: string; lastName: string }) {
  return `${c.firstName} ${c.lastName}`.trim();
}
