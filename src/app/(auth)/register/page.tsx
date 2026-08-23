import type { Metadata } from "next";
import Link from "next/link";
import { Users2 } from "lucide-react";
import { isSharedDemoInstance } from "@/lib/demo-guard";
import { RegisterForm } from "./register-form";

export const metadata: Metadata = { title: "Create account" };

export default function RegisterPage() {
  // On the shared demo the unqualified promise below is false: the workspace
  // already exists, it is shared with every visitor, and the nightly reset
  // deletes what you add. Say so before someone types real data into it.
  const sharedDemo = isSharedDemoInstance();

  return (
    <div>
      <h2 className="text-xl font-semibold tracking-tight text-ink">
        {sharedDemo ? "Join the shared demo" : "Create your workspace"}
      </h2>
      <p className="mt-1 text-sm text-ink-faint">
        {sharedDemo
          ? "This is a public sandbox, not a private workspace."
          : "The first account becomes the workspace admin."}
      </p>

      {sharedDemo ? (
        <div className="mt-5 flex gap-3 rounded-lg border border-warn/30 bg-warn-soft px-4 py-3.5">
          <Users2 className="mt-0.5 h-4 w-4 shrink-0 text-warn" />
          <div className="text-[13px] leading-5 text-ink-muted">
            <p className="font-medium text-ink">
              Everything here is shared and temporary.
            </p>
            <ul className="mt-1.5 list-disc space-y-1 pl-4">
              <li>Records you create are visible to everyone using this demo.</li>
              <li>
                The published demo account is an admin and can edit them.
              </li>
              <li>All CRM data is deleted and re-seeded every night.</li>
            </ul>
            <p className="mt-2">
              Please don&apos;t enter real customer details.{" "}
              <a
                href="https://github.com/jasrulete/Nexus-CRM"
                className="font-medium text-accent hover:text-accent-hover"
              >
                Self-host it
              </a>{" "}
              for a workspace that is actually yours.
            </p>
          </div>
        </div>
      ) : null}

      <div className="mt-7">
        <RegisterForm />
      </div>
      <p className="mt-6 text-[13px] text-ink-faint">
        Already have an account?{" "}
        <Link
          href="/login"
          className="font-medium text-accent hover:text-accent-hover"
        >
          Sign in
        </Link>
      </p>
    </div>
  );
}
