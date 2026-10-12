import { isWorkspaceAdmin } from "@/lib/authz";
import { requireWorkspacePage } from "@/lib/workspace-context";
import { CommandPalette } from "@/components/command-palette";
import { Sidebar } from "@/components/sidebar";
import { ThemeToggle } from "@/components/theme-toggle";
import { UserMenu } from "@/components/user-menu";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // The proxy only tests cookie presence. This resolves the session and the
  // workspace for the header, but under Next 16 partial rendering a layout does
  // not re-run on navigation and does not stop a page rendering, so every page
  // calls requireWorkspacePage() itself. The client menu gets display fields
  // only; the role is decided here, on the server.
  const ctx = await requireWorkspacePage();

  return (
    <div className="flex min-h-dvh flex-1">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-40 flex h-14 items-center justify-end gap-2 border-b border-edge bg-canvas/80 px-4 backdrop-blur md:px-8">
          <CommandPalette />
          <ThemeToggle />
          <UserMenu
            user={{ name: ctx.user.name, email: ctx.user.email, isAdmin: isWorkspaceAdmin(ctx.role) }}
          />
        </header>
        <main className="flex-1 px-4 py-6 md:px-8 md:py-8">{children}</main>
      </div>
    </div>
  );
}
