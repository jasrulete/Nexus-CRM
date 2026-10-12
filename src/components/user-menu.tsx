"use client";

import { LogOut, ShieldCheck } from "lucide-react";
import { logout } from "@/lib/auth/actions";
import { Avatar } from "@/components/ui/avatar";
import {
  Menu,
  MenuContent,
  MenuItem,
  MenuSeparator,
  MenuTrigger,
} from "@/components/ui/dropdown";

export function UserMenu({
  user,
}: {
  // Display fields only. Whether to show the admin label is decided on the
  // server with isWorkspaceAdmin, so no role string reaches the client.
  user: { name: string; email: string; isAdmin: boolean };
}) {
  return (
    <Menu>
      <MenuTrigger
        aria-label="Account menu"
        className="cursor-pointer rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        <Avatar name={user.name} />
      </MenuTrigger>
      <MenuContent>
        <div className="px-2.5 py-2">
          <p className="text-[13px] font-medium text-ink">{user.name}</p>
          <p className="text-[12px] text-ink-faint">{user.email}</p>
          {user.isAdmin ? (
            <p className="mt-1 inline-flex items-center gap-1 text-[11px] font-medium text-accent">
              <ShieldCheck className="h-3 w-3" /> Workspace admin
            </p>
          ) : null}
        </div>
        <MenuSeparator />
        <MenuItem destructive onSelect={() => void logout()}>
          <LogOut className="h-4 w-4" /> Sign out
        </MenuItem>
      </MenuContent>
    </Menu>
  );
}
