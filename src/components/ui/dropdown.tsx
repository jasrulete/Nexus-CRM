"use client";

import * as Dropdown from "@radix-ui/react-dropdown-menu";
import { cn } from "@/lib/utils";

export const Menu = Dropdown.Root;
export const MenuTrigger = Dropdown.Trigger;

export function MenuContent({
  className,
  children,
  align = "end",
}: {
  className?: string;
  children: React.ReactNode;
  align?: "start" | "center" | "end";
}) {
  return (
    <Dropdown.Portal>
      <Dropdown.Content
        align={align}
        sideOffset={6}
        className={cn(
          "z-50 min-w-44 rounded-xl border border-edge bg-surface p-1 shadow-xl",
          className,
        )}
      >
        {children}
      </Dropdown.Content>
    </Dropdown.Portal>
  );
}

export function MenuItem({
  className,
  destructive,
  ...props
}: Dropdown.DropdownMenuItemProps & { destructive?: boolean }) {
  return (
    <Dropdown.Item
      className={cn(
        "flex cursor-pointer select-none items-center gap-2 rounded-lg px-2.5 py-2 text-[13px] outline-none",
        destructive
          ? "text-danger data-[highlighted]:bg-danger-soft"
          : "text-ink data-[highlighted]:bg-surface-2",
        className,
      )}
      {...props}
    />
  );
}

export function MenuSeparator() {
  return <Dropdown.Separator className="my-1 h-px bg-edge" />;
}
