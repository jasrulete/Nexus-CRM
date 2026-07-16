"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatCompactCurrency, formatCurrency } from "@/lib/utils";
import { ChartTooltipFrame } from "./chart-tooltip";

export type PipelineDatum = { stage: string; label: string; value: number; count: number };

// Ordinal single-hue ramp (validated) — order matches funnel order.
const RAMP = ["var(--ramp-1)", "var(--ramp-2)", "var(--ramp-3)", "var(--ramp-4)"];

export function PipelineChart({ data }: { data: PipelineDatum[] }) {
  return (
    <div className="h-64 w-full px-2 pb-3" role="img" aria-label="Open pipeline value by stage">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 20, right: 8, left: 8, bottom: 0 }}>
          <CartesianGrid
            vertical={false}
            stroke="var(--chart-grid)"
            strokeWidth={1}
          />
          <XAxis
            dataKey="label"
            axisLine={{ stroke: "var(--chart-grid)" }}
            tickLine={false}
            tick={{ fill: "var(--chart-axis)", fontSize: 11 }}
            dy={6}
          />
          <YAxis
            axisLine={false}
            tickLine={false}
            tick={{ fill: "var(--chart-axis)", fontSize: 11 }}
            tickFormatter={(v: number) => formatCompactCurrency(v)}
            width={52}
          />
          <Tooltip
            cursor={{ fill: "var(--surface-2)", opacity: 0.6 }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const d = payload[0]!.payload as PipelineDatum;
              return (
                <ChartTooltipFrame
                  label={d.label}
                  rows={[
                    { name: "Value", value: formatCurrency(d.value) },
                    { name: "Deals", value: String(d.count) },
                  ]}
                />
              );
            }}
          />
          <Bar
            dataKey="value"
            radius={[4, 4, 0, 0]}
            maxBarSize={44}
            label={{
              position: "top",
              fill: "var(--chart-axis)",
              fontSize: 11,
              formatter: (v) =>
                typeof v === "number" && v > 0 ? formatCompactCurrency(v) : "",
            }}
          >
            {data.map((d, i) => (
              <Cell key={d.stage} fill={RAMP[i % RAMP.length]} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
