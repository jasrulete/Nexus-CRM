import { KanbanSquare, Sparkles, ShieldCheck } from "lucide-react";

import { Card } from "@/components/ui/card";
import { ProductShot } from "./product-shot";

// Same three pillars the sign-in panel leads with, so the product tells one
// story either way a visitor arrives.
const features = [
  {
    icon: KanbanSquare,
    title: "Pipeline that moves with you",
    text: "Drag deals through stages on a kanban board and watch forecasts update instantly.",
  },
  {
    icon: Sparkles,
    title: "AI on every record",
    text: "Lead scoring, relationship summaries and follow-up drafts — with a transparent rule-based mode when no API key is set.",
  },
  {
    icon: ShieldCheck,
    title: "Security by default",
    text: "Hashed sessions, rate-limited sign-in, role-based access and a strict content security policy.",
  },
];

export function FeatureGrid() {
  return (
    <section className="mx-auto max-w-6xl px-6 py-16 sm:py-20">
      <div className="grid gap-6 sm:grid-cols-3">
        {features.map((feature) => (
          <Card interactive key={feature.title} className="p-6">
            <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-accent-soft text-accent transition-colors duration-200 group-hover:bg-accent group-hover:text-on-accent">
              <feature.icon className="h-4.5 w-4.5" />
            </span>
            <h2 className="mt-4 text-base font-semibold tracking-tight text-ink">
              {feature.title}
            </h2>
            <p className="mt-2 text-sm leading-6 text-ink-muted">
              {feature.text}
            </p>
          </Card>
        ))}
      </div>

      <div className="mt-12 overflow-hidden rounded-xl border border-edge bg-surface shadow-lg">
        <ProductShot
          light="/marketing/pipeline-light.png"
          dark="/marketing/pipeline-dark.png"
          alt="The deals board: cards grouped into Lead, Qualified, Proposal, Negotiation and Won columns, each showing value, contact, company and close date."
        />
      </div>
    </section>
  );
}
