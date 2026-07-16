"use client";

import { useActionState, useState } from "react";
import { Loader2 } from "lucide-react";
import { createContact, updateContact } from "@/server/actions/contacts";
import { idle, type ActionState } from "@/lib/action-state";
import {
  CONTACT_SOURCES,
  CONTACT_STATUSES,
  CONTACT_STATUS_LABELS,
} from "@/lib/constants";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { FieldError, Input, Label, Select, Textarea } from "@/components/ui/input";

export type ContactFormValues = {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  title: string | null;
  status: string;
  source: string | null;
  notes: string | null;
  companyId: string | null;
};

export function ContactFormDialog({
  trigger,
  contact,
  companies,
}: {
  trigger: React.ReactNode;
  contact?: ContactFormValues;
  companies: { id: string; name: string }[];
}) {
  const [open, setOpen] = useState(false);
  const boundAction = contact
    ? updateContact.bind(null, contact.id)
    : createContact;
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
        title={contact ? "Edit contact" : "New contact"}
        description={
          contact
            ? "Update this contact's details."
            : "Add a person to your workspace."
        }
      >
        <form action={action} className="space-y-4">
          {state.message ? (
            <div className="rounded-lg border border-danger/30 bg-danger-soft px-3 py-2.5 text-[13px] text-danger">
              {state.message}
            </div>
          ) : null}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="firstName">First name</Label>
              <Input
                id="firstName"
                name="firstName"
                defaultValue={contact?.firstName}
                required
              />
              <FieldError message={state.errors?.firstName} />
            </div>
            <div>
              <Label htmlFor="lastName">Last name</Label>
              <Input
                id="lastName"
                name="lastName"
                defaultValue={contact?.lastName}
                required
              />
              <FieldError message={state.errors?.lastName} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="c-email">Email</Label>
              <Input
                id="c-email"
                name="email"
                type="email"
                defaultValue={contact?.email ?? ""}
              />
              <FieldError message={state.errors?.email} />
            </div>
            <div>
              <Label htmlFor="phone">Phone</Label>
              <Input id="phone" name="phone" defaultValue={contact?.phone ?? ""} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="title">Job title</Label>
              <Input id="title" name="title" defaultValue={contact?.title ?? ""} />
            </div>
            <div>
              <Label htmlFor="companyId">Company</Label>
              <Select
                id="companyId"
                name="companyId"
                defaultValue={contact?.companyId ?? ""}
              >
                <option value="">No company</option>
                {companies.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="status">Status</Label>
              <Select
                id="status"
                name="status"
                defaultValue={contact?.status ?? "LEAD"}
              >
                {CONTACT_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {CONTACT_STATUS_LABELS[s]}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="source">Source</Label>
              <Select
                id="source"
                name="source"
                defaultValue={contact?.source ?? ""}
              >
                <option value="">Unknown</option>
                {CONTACT_SOURCES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </Select>
            </div>
          </div>
          <div>
            <Label htmlFor="notes">Notes</Label>
            <Textarea
              id="notes"
              name="notes"
              defaultValue={contact?.notes ?? ""}
              placeholder="Context, preferences, next steps…"
            />
            <FieldError message={state.errors?.notes} />
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {contact ? "Save changes" : "Create contact"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
