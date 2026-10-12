import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { workspaceMode } from "@/lib/workspace-mode";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage() {
  // Rendered per request: whether to offer the demo depends on WORKSPACE_MODE,
  // which is read at runtime so one build serves both modes.
  await connection();

  // "Try the demo" signs in with the published demo credentials. In multi mode
  // that address is an ordinary registrable email, so the button would sign
  // visitors in to whoever registered it.
  const showDemo = workspaceMode() === "single";

  return (
    <div>
      <h2 className="text-xl font-semibold tracking-tight text-ink">
        Welcome back
      </h2>
      <p className="mt-1 text-sm text-ink-faint">
        Sign in to your workspace to continue.
      </p>
      <div className="mt-7">
        <LoginForm showDemo={showDemo} />
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
