"use client";

import { useActionState, useState } from "react";
import { Loader2, Trash2 } from "lucide-react";
import { createDeal, deleteDeal, updateDeal } from "@/server/actions/deals";
import { idle, type ActionState } from "@/lib/action-state";
import { DEAL_STAGES, STAGE_LABELS } from "@/lib/constants";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { FieldError, Input, Label, Select } from "@/components/ui/input";

export type DealFormValues = {
  id: string;
  title: string;
  value: number;
  stage: string;
  expectedCloseDate: string | null;
  contactId: string | null;
  companyId: string | null;
};

export function DealFormDialog({
  open,
  onOpenChange,
  deal,
  contacts,
  companies,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  deal?: DealFormValues | null;
  contacts: { id: string; name: string }[];
  companies: { id: string; name: string }[];
}) {
  const boundAction = deal ? updateDeal.bind(null, deal.id) : createDeal;
  const [state, action, pending] = useActionState<ActionState, FormData>(
    async (prev, formData) => {
      const result = await boundAction(prev, formData);
      if (result.success) onOpenChange(false);
      return result;
    },
    idle,
  );
  const [deleting, setDeleting] = useState(false);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={deal ? "Edit deal" : "New deal"}
        description={
          deal ? "Update this opportunity." : "Track a new opportunity."
        }
      >
        <form action={action} className="space-y-4" key={deal?.id ?? "new"}>
          {state.message ? (
            <div className="rounded-lg border border-danger/30 bg-danger-soft px-3 py-2.5 text-[13px] text-danger">
              {state.message}
            </div>
          ) : null}
          <div>
            <Label htmlFor="d-title">Title</Label>
            <Input
              id="d-title"
              name="title"
              defaultValue={deal?.title}
              placeholder="Acme — Annual plan"
              required
            />
            <FieldError message={state.errors?.title} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="d-value">Value (USD)</Label>
              <Input
                id="d-value"
                name="value"
                type="number"
                min={0}
                step={1}
                defaultValue={deal?.value ?? 0}
                required
              />
              <FieldError message={state.errors?.value} />
            </div>
            <div>
              <Label htmlFor="d-stage">Stage</Label>
              <Select id="d-stage" name="stage" defaultValue={deal?.stage ?? "LEAD"}>
                {DEAL_STAGES.map((s) => (
                  <option key={s} value={s}>
                    {STAGE_LABELS[s]}
                  </option>
                ))}
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="d-contact">Contact</Label>
              <Select
                id="d-contact"
                name="contactId"
                defaultValue={deal?.contactId ?? ""}
              >
                <option value="">None</option>
                {contacts.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="d-company">Company</Label>
              <Select
                id="d-company"
                name="companyId"
                defaultValue={deal?.companyId ?? ""}
              >
                <option value="">None</option>
                {companies.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </div>
          </div>
          <div>
            <Label htmlFor="d-close">Expected close date</Label>
            <Input
              id="d-close"
              name="expectedCloseDate"
              type="date"
              defaultValue={deal?.expectedCloseDate ?? ""}
            />
            <FieldError message={state.errors?.expectedCloseDate} />
          </div>
          <div className="flex items-center justify-between gap-2 pt-1">
            {deal ? (
              <Button
                type="button"
                variant="danger"
                size="sm"
                disabled={deleting}
                onClick={async () => {
                  setDeleting(true);
                  try {
                    await deleteDeal(deal.id);
                    onOpenChange(false);
                  } finally {
                    setDeleting(false);
                  }
                }}
              >
                {deleting ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Trash2 className="h-3.5 w-3.5" />
                )}
                Delete
              </Button>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <Button
                type="button"
                variant="secondary"
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {deal ? "Save changes" : "Create deal"}
              </Button>
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
