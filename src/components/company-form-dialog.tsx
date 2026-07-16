"use client";

import { useActionState, useState } from "react";
import { Loader2 } from "lucide-react";
import { createCompany, updateCompany } from "@/server/actions/companies";
import { idle, type ActionState } from "@/lib/action-state";
import { COMPANY_SIZES } from "@/lib/constants";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { FieldError, Input, Label, Select, Textarea } from "@/components/ui/input";

export type CompanyFormValues = {
  id: string;
  name: string;
  domain: string | null;
  industry: string | null;
  size: string | null;
  website: string | null;
  notes: string | null;
};

export function CompanyFormDialog({
  trigger,
  company,
}: {
  trigger: React.ReactNode;
  company?: CompanyFormValues;
}) {
  const [open, setOpen] = useState(false);
  const boundAction = company
    ? updateCompany.bind(null, company.id)
    : createCompany;
  const [state, action, pending] = useActionState<ActionState, FormData>(
    async (prev, formData) => {
      const result = await boundAction(prev, formData);
      if (result.success) setOpen(false);
      return result;
    },
    idle,
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent
        title={company ? "Edit company" : "New company"}
        description={
          company ? "Update this company's details." : "Add an organization."
        }
      >
        <form action={action} className="space-y-4">
          {state.message ? (
            <div className="rounded-lg border border-danger/30 bg-danger-soft px-3 py-2.5 text-[13px] text-danger">
              {state.message}
            </div>
          ) : null}
          <div>
            <Label htmlFor="co-name">Name</Label>
            <Input id="co-name" name="name" defaultValue={company?.name} required />
            <FieldError message={state.errors?.name} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="industry">Industry</Label>
              <Input
                id="industry"
                name="industry"
                defaultValue={company?.industry ?? ""}
                placeholder="SaaS, Retail…"
              />
            </div>
            <div>
              <Label htmlFor="size">Size</Label>
              <Select id="size" name="size" defaultValue={company?.size ?? ""}>
                <option value="">Unknown</option>
                {COMPANY_SIZES.map((s) => (
                  <option key={s} value={s}>
                    {s} people
                  </option>
                ))}
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="domain">Domain</Label>
              <Input
                id="domain"
                name="domain"
                defaultValue={company?.domain ?? ""}
                placeholder="acme.com"
              />
            </div>
            <div>
              <Label htmlFor="website">Website</Label>
              <Input
                id="website"
                name="website"
                defaultValue={company?.website ?? ""}
                placeholder="https://acme.com"
              />
              <FieldError message={state.errors?.website} />
            </div>
          </div>
          <div>
            <Label htmlFor="co-notes">Notes</Label>
            <Textarea
              id="co-notes"
              name="notes"
              defaultValue={company?.notes ?? ""}
            />
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {company ? "Save changes" : "Create company"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
