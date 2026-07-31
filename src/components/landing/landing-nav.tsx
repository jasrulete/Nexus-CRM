import Link from "next/link";

import { BrandLockup } from "@/components/brand";
import { REPO_URL } from "./links";

export function LandingNav() {
  return (
    <header className="border-b border-edge/70">
      <nav className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
        <BrandLockup />

        <div className="flex items-center gap-1.5 sm:gap-3">
          <a
            href={REPO_URL}
            target="_blank"
            rel="noreferrer"
            className="hidden rounded-lg px-3 py-2 text-sm font-medium text-ink-muted transition-colors hover:text-ink sm:inline-flex"
          >
            GitHub
          </a>
          <Link
            href="/login"
            className="rounded-lg px-3 py-2 text-sm font-medium text-ink-muted transition-colors hover:text-ink"
          >
            Sign in
          </Link>
          <Link
            href="/login"
            className="inline-flex h-9 items-center rounded-lg bg-accent px-4 text-sm font-medium text-on-accent shadow-sm transition-colors hover:bg-accent-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            Try the demo
          </Link>
        </div>
      </nav>
    </header>
  );
}
