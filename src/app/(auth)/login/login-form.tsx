"use client";

import { useActionState, useRef } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { login, type AuthFormState } from "@/lib/auth/actions";
import { Button } from "@/components/ui/button";
import { FieldError, Input, Label } from "@/components/ui/input";

const initial: AuthFormState = {};

// Public demo credentials (also in the README) — the button below goes through
// the normal login action, so rate limiting and the audit log still apply.
const DEMO_EMAIL = "demo@nexuscrm.dev";
const DEMO_PASSWORD = "demo-password-123";

export function LoginForm() {
  const [state, action, pending] = useActionState(login, initial);
  const formRef = useRef<HTMLFormElement>(null);

  function tryDemo() {
    const form = formRef.current;
    if (!form) return;
    (form.elements.namedItem("email") as HTMLInputElement).value = DEMO_EMAIL;
    (form.elements.namedItem("password") as HTMLInputElement).value =
      DEMO_PASSWORD;
    form.requestSubmit();
  }

  return (
    <form ref={formRef} action={action} className="space-y-4">
      {state.message ? (
        <div className="rounded-lg border border-danger/30 bg-danger-soft px-3 py-2.5 text-[13px] text-danger">
          {state.message}
        </div>
      ) : null}
      <div>
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          placeholder="you@company.com"
          required
        />
        <FieldError message={state.errors?.email} />
      </div>
      <div>
        <Label htmlFor="password">Password</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          placeholder="••••••••"
          required
        />
        <FieldError message={state.errors?.password} />
      </div>
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
        Sign in
      </Button>
      <div className="rounded-lg border border-edge-strong/70 bg-surface-2 px-3 py-3">
        <p className="text-[13px] text-ink-faint">
          Just exploring? Jump into a fully seeded demo workspace — contacts,
          deals and a live pipeline included.
        </p>
        <Button
          type="button"
          variant="secondary"
          disabled={pending}
          onClick={tryDemo}
          className="mt-2.5 w-full"
        >
          <Sparkles className="h-4 w-4" />
          Try the demo
        </Button>
      </div>
    </form>
  );
}
