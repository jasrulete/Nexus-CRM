"use client";

import { useState, useTransition } from "react";
import { Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";

/**
 * A server action that ends in redirect() rejects the client's promise on
 * purpose: Next's action reducer performs the navigation itself and rejects
 * with a redirect error (marked handled) so an error boundary can remount the
 * caller — see next/dist/client/components/router-reducer/reducers/server-action-reducer.js.
 * Every delete here redirects to its list, so that rejection is the success
 * path, not "Something went wrong".
 */
function isRedirect(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "digest" in error &&
    String((error as { digest: unknown }).digest).startsWith("NEXT_REDIRECT")
  );
}

export function DeleteButton({
  label,
  description,
  onConfirm,
  disabledReason,
}: {
  label: string;
  description: string;
  onConfirm: () => Promise<void>;
  /** When set, the dialog explains why instead of letting the delete run. */
  disabledReason?: string;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="danger" size="sm">
          <Trash2 className="h-3.5 w-3.5" /> {label}
        </Button>
      </DialogTrigger>
      <DialogContent title="Are you sure?" description={description}>
        {disabledReason ? (
          <p className="mb-3 rounded-lg border border-edge bg-surface-2 px-3 py-2 text-[13px] text-ink-muted">
            {disabledReason}
          </p>
        ) : null}
        {error ? (
          <p className="mb-3 rounded-lg border border-danger/30 bg-danger-soft px-3 py-2 text-[13px] text-danger">
            {error}
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            variant="danger"
            disabled={pending || Boolean(disabledReason)}
            onClick={() =>
              startTransition(async () => {
                try {
                  setError(null);
                  await onConfirm();
                  setOpen(false);
                } catch (e) {
                  if (isRedirect(e)) return;
                  setError(
                    e instanceof Error && e.message.includes("FORBIDDEN")
                      ? "Only the owner or an admin can delete this."
                      : "Something went wrong. Try again.",
                  );
                }
              })
            }
          >
            {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Delete
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
