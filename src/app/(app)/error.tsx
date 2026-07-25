"use client";

import { useEffect } from "react";
import { RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export default function AppError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4">
      <Card className="w-full max-w-md p-6 text-center">
        <h1 className="text-base font-semibold text-ink">Something went wrong</h1>
        <p className="mt-1.5 text-[13px] leading-5 text-ink-muted">
          This page failed to load. Retrying usually fixes it.
        </p>
        {error.digest ? (
          <p className="mt-3 font-mono text-[11px] text-ink-faint">
            Reference: {error.digest}
          </p>
        ) : null}
        <Button className="mt-5" onClick={() => unstable_retry()}>
          <RotateCw className="h-4 w-4" />
          Try again
        </Button>
      </Card>
    </div>
  );
}
