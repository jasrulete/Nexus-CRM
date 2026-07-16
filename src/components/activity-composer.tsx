"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { Loader2, Mail, NotebookPen, Phone, Users } from "lucide-react";
import { createActivity } from "@/server/actions/activities";
import { idle, type ActionState } from "@/lib/action-state";
import { ACTIVITY_TYPES, type ActivityType } from "@/lib/constants";
import { Button } from "@/components/ui/button";
import { FieldError, Textarea } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const icons: Record<ActivityType, typeof NotebookPen> = {
  NOTE: NotebookPen,
  CALL: Phone,
  EMAIL: Mail,
  MEETING: Users,
};

export function ActivityComposer({
  contactId,
  dealId,
  companyId,
}: {
  contactId?: string;
  dealId?: string;
  companyId?: string;
}) {
  const [type, setType] = useState<ActivityType>("NOTE");
  const [state, action, pending] = useActionState<ActionState, FormData>(
    createActivity,
    idle,
  );
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.success) formRef.current?.reset();
  }, [state]);

  return (
    <form ref={formRef} action={action} className="px-5 pb-4">
      <input type="hidden" name="type" value={type} />
      {contactId ? <input type="hidden" name="contactId" value={contactId} /> : null}
      {dealId ? <input type="hidden" name="dealId" value={dealId} /> : null}
      {companyId ? <input type="hidden" name="companyId" value={companyId} /> : null}

      <div className="mb-2 flex gap-1">
        {ACTIVITY_TYPES.map((t) => {
          const Icon = icons[t];
          return (
            <button
              key={t}
              type="button"
              onClick={() => setType(t)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12px] font-medium transition-colors cursor-pointer",
                type === t
                  ? "bg-accent-soft text-accent"
                  : "text-ink-faint hover:bg-surface-2 hover:text-ink",
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {t.charAt(0) + t.slice(1).toLowerCase()}
            </button>
          );
        })}
      </div>
      <Textarea
        name="content"
        placeholder={
          type === "NOTE"
            ? "Write a note…"
            : `Log a ${type.toLowerCase()} — what happened?`
        }
        className="min-h-16"
      />
      <FieldError message={state.errors?.content} />
      {state.message ? (
        <p className="mt-1 text-[12px] text-danger">{state.message}</p>
      ) : null}
      <div className="mt-2 flex justify-end">
        <Button size="sm" type="submit" disabled={pending}>
          {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
          Log {type.toLowerCase()}
        </Button>
      </div>
    </form>
  );
}
