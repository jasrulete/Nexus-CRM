/**
 * Calendar-month bucketing shared by the dashboard's revenue chart and the
 * seed that has to fill it.
 *
 * Kept in one place because the two used to agree only by accident: the
 * dashboard computed its window with `setMonth(getMonth() - 5)` and only then
 * `setDate(1)`. On July 29–31 that produced "February 29–31", which JavaScript
 * normalises into early March, so the window became March–August: February's
 * revenue vanished and the chart drew an empty month that had not started yet.
 * Three days a year, with nothing to say so. Building the date from parts
 * with the day fixed at 1 cannot overflow.
 */

/** `YYYY-MM` in the process's local time — the frame the chart labels in. */
export function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** Local-midnight first-of-month for the current month and the five before it, oldest first. */
export function lastSixMonths(now: Date = new Date()): Date[] {
  return Array.from({ length: 6 }, (_, i) => new Date(now.getFullYear(), now.getMonth() - 5 + i, 1));
}
