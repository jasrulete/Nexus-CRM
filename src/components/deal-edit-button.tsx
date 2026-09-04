"use client";

import { useState } from "react";
import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DealFormDialog, type DealFormValues } from "@/components/deal-form-dialog";

/**
 * The deal dialog is controlled (the board opens it for "New deal"), so the
 * detail page needs somewhere to hold the open state on the client.
 */
export function DealEditButton({
  deal,
  contacts,
  companies,
}: {
  deal: DealFormValues;
  contacts: { id: string; name: string }[];
  companies: { id: string; name: string }[];
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        <Pencil className="h-3.5 w-3.5" /> Edit
      </Button>
      <DealFormDialog
        open={open}
        onOpenChange={setOpen}
        deal={deal}
        contacts={contacts}
        companies={companies}
      />
    </>
  );
}
