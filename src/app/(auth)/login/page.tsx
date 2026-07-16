import type { Metadata } from "next";
import Link from "next/link";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

export default function LoginPage() {
  return (
    <div>
      <h2 className="text-xl font-semibold tracking-tight text-ink">
        Welcome back
      </h2>
      <p className="mt-1 text-sm text-ink-faint">
        Sign in to your workspace to continue.
      </p>
      <div className="mt-7">
        <LoginForm />
      </div>
      <p className="mt-6 text-[13px] text-ink-faint">
        No account yet?{" "}
        <Link
          href="/register"
          className="font-medium text-accent hover:text-accent-hover"
        >
          Create one
        </Link>
      </p>
    </div>
  );
}
