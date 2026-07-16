"use client";

export function ChartTooltipFrame({
  label,
  rows,
}: {
  label: string;
  rows: { name: string; value: string; swatch?: string }[];
}) {
  return (
    <div className="rounded-lg border border-edge bg-surface px-3 py-2 shadow-lg">
      <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-ink-faint">
        {label}
      </p>
      {rows.map((r) => (
        <p key={r.name} className="flex items-center gap-2 text-[13px] text-ink">
          {r.swatch ? (
            <span
              aria-hidden
              className="inline-block h-2.5 w-2.5 rounded-[3px]"
              style={{ background: r.swatch }}
            />
          ) : null}
          <span className="text-ink-muted">{r.name}</span>
          <span className="ml-auto pl-3 font-semibold tabular-nums">{r.value}</span>
        </p>
      ))}
    </div>
  );
}
