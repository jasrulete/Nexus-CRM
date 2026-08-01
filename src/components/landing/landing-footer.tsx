import { BrandLockup } from "@/components/brand";
import { REPO_URL } from "./links";

export function LandingFooter() {
  return (
    <footer className="mx-auto max-w-6xl px-6 py-12">
      <div className="flex flex-col gap-6 border-t border-edge/70 pt-8 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <BrandLockup href="/" />
          <p className="mt-3 max-w-md text-sm leading-6 text-ink-muted">
            A portfolio project built by{" "}
            <span className="font-medium text-ink">Jeric Rulete</span> to
            explore full-stack product work: AI features, authentication and
            deployment on a free-tier stack.
          </p>
        </div>

        <a
          href={REPO_URL}
          target="_blank"
          rel="noreferrer"
          className="inline-flex h-9 shrink-0 items-center rounded-lg border border-edge-strong/70 bg-surface px-4 text-sm font-medium text-ink shadow-sm transition-colors hover:bg-surface-2"
        >
          View on GitHub
        </a>
      </div>
    </footer>
  );
}
