"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Building2,
  KanbanSquare,
  LayoutDashboard,
  Settings,
  Users,
} from "lucide-react";
import { BrandLockup } from "@/components/brand";
import { cn } from "@/lib/utils";

const nav = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/contacts", label: "Contacts", icon: Users },
  { href: "/companies", label: "Companies", icon: Building2 },
  { href: "/deals", label: "Deals", icon: KanbanSquare },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="sticky top-0 flex h-dvh w-16 shrink-0 flex-col border-r border-edge bg-surface md:w-56">
      <div className="flex h-14 items-center border-b border-edge px-3 md:px-5">
        <span className="hidden md:block">
          <BrandLockup />
        </span>
        <span className="md:hidden">
          <BrandLockup className="[&>span:last-child]:hidden" />
        </span>
      </div>
      <nav className="flex-1 space-y-1 p-2 md:p-3">
        {nav.map((item) => {
          const active =
            pathname === item.href || pathname.startsWith(item.href + "/");
          return (
            <Link
              key={item.href}
              href={item.href}
              title={item.label}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                "justify-center md:justify-start",
                active
                  ? "bg-accent-soft text-accent"
                  : "text-ink-muted hover:bg-surface-2 hover:text-ink",
              )}
            >
              <item.icon className="h-[18px] w-[18px] shrink-0" />
              <span className="hidden md:inline">{item.label}</span>
            </Link>
          );
        })}
      </nav>
      <div className="hidden border-t border-edge p-4 text-[11px] leading-4 text-ink-faint md:block">
        Self-hosted · Open source
      </div>
    </aside>
  );
}
