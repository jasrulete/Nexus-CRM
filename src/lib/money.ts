/**
 * Money display and the workspace currency.
 *
 * A deal is stored twice: `value` in the currency the user typed, and
 * `baseValue` converted into the workspace currency at a rate frozen when the
 * deal was written (`fxRate`). Every total, chart and column footer in the app
 * sums `baseValue` — never `value` — so mixed currencies cannot be added
 * together, and a historical total does not drift as rates move.
 *
 * Before this, `Deal.currency` was written on every row and read nowhere: the
 * moment anything wrote a non-USD value, EUR 62,000 and USD 48,000 would have
 * been summed and rendered as "$110,000".
 */

/**
 * The single currency every aggregate is expressed in.
 *
 * A constant rather than a per-workspace column: there is one workspace, and a
 * settings UI to change it is a feature nobody has asked for. Overridable by
 * env so a self-hoster is not stuck with dollars.
 */
export const WORKSPACE_CURRENCY = process.env.WORKSPACE_CURRENCY || "USD";

/**
 * What a deal may be entered in. A short list rather than every ISO code the
 * rate provider knows: it is a `<select>`, and a hundred options is not a UI.
 */
export const SUPPORTED_CURRENCIES = [
  "USD",
  "EUR",
  "GBP",
  "AUD",
  "CAD",
  "SGD",
  "JPY",
  "PHP",
] as const;

export type SupportedCurrency = (typeof SUPPORTED_CURRENCIES)[number];

export function isSupportedCurrency(value: string): value is SupportedCurrency {
  return (SUPPORTED_CURRENCIES as readonly string[]).includes(value);
}

/** True when a deal needs converting at all. */
export function needsConversion(currency: string): boolean {
  return currency !== WORKSPACE_CURRENCY;
}

/**
 * Applies a rate and rounds to whole units, matching how amounts are stored.
 *
 * Rounded once, here, so the stored `baseValue` and anything recomputed from
 * `value * fxRate` agree exactly rather than drifting by a unit.
 */
export function convertAmount(value: number, rate: number): number {
  return Math.round(value * rate);
}

function format(value: number, currency: string): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

/**
 * A deal amount for display: the converted amount, with the amount actually
 * entered alongside it when the two differ.
 *
 *   USD deal in a USD workspace -> "$48,000"
 *   EUR deal in a USD workspace -> "$72,538 (EUR 62,000)"
 *
 * The original is shown as code + amount rather than a symbol, because two
 * currencies can share a glyph — "$72,538 ($62,000)" would be unreadable for a
 * CAD or SGD deal.
 */
export function formatDealAmount(deal: {
  value: number;
  currency: string;
  baseValue: number;
}): string {
  const converted = format(deal.baseValue, WORKSPACE_CURRENCY);
  if (!needsConversion(deal.currency)) return converted;
  return `${converted} (${deal.currency} ${new Intl.NumberFormat("en-US").format(deal.value)})`;
}
