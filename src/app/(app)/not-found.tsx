import Link from "next/link";
import { Card } from "@/components/ui/card";

export default function AppNotFound() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4">
      <Card className="w-full max-w-md p-8 text-center">
        <p className="font-mono text-[13px] text-ink-faint">404</p>
        <h1 className="mt-2 text-base font-semibold text-ink">Not found</h1>
        <p className="mt-1.5 text-[13px] leading-5 text-ink-muted">
          That record may have been deleted, or the link is out of date.
        </p>
        <Link
          href="/dashboard"
          className="mt-5 inline-flex h-9 items-center justify-center rounded-lg bg-accent px-4 text-sm font-medium text-on-accent transition-colors hover:bg-accent-hover"
        >
          Back to dashboard
        </Link>
      </Card>
    </div>
  );
}
