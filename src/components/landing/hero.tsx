import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { REPO_URL } from "./links";
import { ProductShot } from "./product-shot";

export function Hero() {
  return (
    <section className="relative overflow-hidden">
      {/* Same radial treatment as the sign-in brand panel, kept subtle so the
          section reads on both themes. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(55% 40% at 50% 0%, rgba(124,58,237,0.16), transparent 70%)",
        }}
      />

      <div className="relative mx-auto max-w-6xl px-6 pt-16 pb-12 sm:pt-24">
        <div className="mx-auto max-w-3xl text-center">
          <span className="inline-flex items-center rounded-full border border-edge bg-surface px-3 py-1 text-[13px] font-medium text-ink-muted">
            Free, open source, self-hosted
          </span>

          <h1 className="mt-6 text-4xl font-semibold leading-[1.1] tracking-tight text-balance text-ink sm:text-5xl">
            Every relationship, one intelligent workspace.
          </h1>

          <p className="mx-auto mt-5 max-w-xl text-base leading-7 text-pretty text-ink-muted">
            Nexus CRM keeps contacts, companies and deals in one place — with
            lead scoring, relationship summaries and follow-up drafts generated
            on every record.
          </p>

          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link
              href="/login"
              className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-accent px-6 text-sm font-medium text-on-accent shadow-sm transition-colors hover:bg-accent-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent sm:w-auto"
            >
              Try the live demo
              <ArrowRight className="h-4 w-4" />
            </Link>
            <a
              href={REPO_URL}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-11 w-full items-center justify-center rounded-lg border border-edge-strong/70 bg-surface px-6 text-sm font-medium text-ink shadow-sm transition-colors hover:bg-surface-2 sm:w-auto"
            >
              View source
            </a>
          </div>

          <p className="mt-4 text-[13px] text-ink-faint">
            No signup — the demo signs you in with one click.
          </p>
        </div>

        <div className="relative mt-14 sm:mt-16">
          <div className="overflow-hidden rounded-xl border border-edge bg-surface shadow-2xl ring-1 ring-black/5">
            <ProductShot
              light="/marketing/dashboard-light.png"
              dark="/marketing/dashboard-dark.png"
              alt="The Nexus CRM dashboard: pipeline totals, win rate, a pipeline-by-stage chart, revenue won over time, open tasks and recent activity."
              priority
            />
          </div>
        </div>
      </div>
    </section>
  );
}
