import { BrandLockup } from "@/components/brand";
import { Sparkles, ShieldCheck, KanbanSquare } from "lucide-react";

const highlights = [
  {
    icon: KanbanSquare,
    title: "Pipeline that moves with you",
    text: "Drag deals through stages and watch forecasts update instantly.",
  },
  {
    icon: Sparkles,
    title: "AI on every record",
    text: "Lead scoring, relationship summaries and follow-up drafts built in.",
  },
  {
    icon: ShieldCheck,
    title: "Security by default",
    text: "Hashed sessions, audit trail and role-based access out of the box.",
  },
];

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-1">
      {/* Brand panel */}
      <aside className="relative hidden w-[44%] flex-col justify-between overflow-hidden bg-[#101019] p-10 lg:flex dark:bg-[#0a0a12]">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "radial-gradient(60% 50% at 20% 10%, rgba(99,102,241,0.35), transparent 60%), radial-gradient(50% 40% at 90% 90%, rgba(56,189,248,0.18), transparent 60%)",
          }}
        />
        <div className="relative">
          <BrandLockup className="[&_span:last-child]:text-white" />
        </div>
        <div className="relative space-y-7">
          <h1 className="max-w-md text-3xl font-semibold leading-tight tracking-tight text-white">
            Every relationship,
            <br />
            one intelligent workspace.
          </h1>
          <ul className="space-y-5">
            {highlights.map((h) => (
              <li key={h.title} className="flex gap-3.5">
                <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/10 text-violet-300">
                  <h.icon className="h-4 w-4" />
                </span>
                <div>
                  <p className="text-sm font-medium text-white">{h.title}</p>
                  <p className="mt-0.5 text-[13px] leading-5 text-white/55">
                    {h.text}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </div>
        <p className="relative text-[12px] text-white/35">
          Free, open-source, self-hosted. Your data stays yours.
        </p>
      </aside>

      {/* Form panel */}
      <main className="flex flex-1 items-center justify-center bg-canvas px-6 py-12">
        <div className="w-full max-w-sm">
          <div className="mb-8 lg:hidden">
            <BrandLockup />
          </div>
          {children}
        </div>
      </main>
    </div>
  );
}
