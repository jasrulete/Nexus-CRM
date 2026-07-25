import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas px-4">
      <div className="w-full max-w-md rounded-xl border border-edge bg-surface p-8 text-center shadow-[0_1px_2px_rgb(0_0_0/0.04)]">
        <p className="font-mono text-[13px] text-ink-faint">404</p>
        <h1 className="mt-2 text-base font-semibold text-ink">Page not found</h1>
        <p className="mt-1.5 text-[13px] leading-5 text-ink-muted">
          That record may have been deleted, or the link is out of date.
        </p>
        <Link
          href="/dashboard"
          className="mt-5 inline-flex h-9 items-center justify-center rounded-lg bg-accent px-4 text-sm font-medium text-on-accent transition-colors hover:bg-accent-hover"
        >
          Back to dashboard
        </Link>
      </div>
    </div>
  );
}
