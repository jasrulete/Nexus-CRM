import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { destroySession, getCurrentUser } from "@/lib/auth/session";
import { SESSION_COOKIE } from "@/lib/auth/session-constants";
import { systemDb } from "@/lib/db";
import { workspaceMode } from "@/lib/workspace-mode";

/**
 * Clears a session that cannot reach a workspace, then sends the browser to
 * /login (spec §5.3). Pages redirect here because cookies can only change in a
 * Route Handler or Server Function, never during render.
 *
 * Two kinds of session land here:
 *  - a stale cookie whose Session row is gone or expired. Without this the
 *    proxy bounced it from /login to /dashboard and the page bounced it back,
 *    forever;
 *  - in multi mode, a signed-in user with no membership.
 *
 * A healthy session is sent on to /dashboard untouched, so a link to this URL
 * on another site cannot sign anyone out. In single mode a missing membership
 * is not stale: the dashboard joins the user to the workspace.
 *
 * The proxy exempts this path, so it runs with or without a cookie. Without
 * one there is nothing to clear, so no deletion Set-Cookie is sent either.
 */
export async function GET() {
  const user = await getCurrentUser();
  if (user) {
    const membership = await systemDb.membership.findUnique({
      where: { userId: user.id },
      select: { id: true },
    });
    if (membership || workspaceMode() === "single") redirect("/dashboard");
  }
  // Deletes the Session row (if any) and the cookie; Next adds the cookie
  // change to the redirect response.
  if ((await cookies()).has(SESSION_COOKIE)) await destroySession();
  redirect("/login");
}
