"use client";

import { useActionState, useEffect, useRef } from "react";
import { Plus } from "lucide-react";
import { createTask } from "@/server/actions/tasks";
import { idle, type ActionState } from "@/lib/action-state";
import { FieldError, Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export function QuickTaskForm({
  contactId,
  dealId,
}: {
  contactId?: string;
  dealId?: string;
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(
    createTask,
    idle,
  );
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.success) formRef.current?.reset();
  }, [state]);

  return (
    <form ref={formRef} action={action} className="flex items-start gap-2 px-5 py-3">
      {contactId ? <input type="hidden" name="contactId" value={contactId} /> : null}
      {dealId ? <input type="hidden" name="dealId" value={dealId} /> : null}
      <div className="flex-1">
        <Input
          name="title"
          placeholder="Add a task…"
          aria-label="Task title"
          className="h-8 text-[13px]"
        />
        <FieldError message={state.errors?.title} />
      </div>
      <Input
        type="date"
        name="dueDate"
        aria-label="Due date"
        className="h-8 w-36 text-[13px]"
      />
      <Button size="sm" type="submit" disabled={pending} aria-label="Add task">
        <Plus className="h-4 w-4" />
      </Button>
    </form>
  );
}
