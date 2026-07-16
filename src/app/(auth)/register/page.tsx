import type { Metadata } from "next";
import Link from "next/link";
import { RegisterForm } from "./register-form";

export const metadata: Metadata = { title: "Create account" };

export default function RegisterPage() {
  return (
    <div>
      <h2 className="text-xl font-semibold tracking-tight text-ink">
        Create your workspace
      </h2>
      <p className="mt-1 text-sm text-ink-faint">
        The first account becomes the workspace admin.
      </p>
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
