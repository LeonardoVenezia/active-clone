"use client";

import { Menu } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { UserMenu } from "@/components/workflows/user-menu";
import { cn } from "@/lib/utils";

const NAV_ITEMS: { href: string; label: string; isActive: (p: string) => boolean }[] = [
  { href: "/workflows", label: "Flows", isActive: (p) => p === "/workflows" },
  { href: "/history", label: "History", isActive: (p) => p.startsWith("/history") },
  { href: "/connections", label: "Connections", isActive: (p) => p.startsWith("/connections") },
  {
    href: "/",
    label: "Editor",
    isActive: (p) => p === "/" || (p.startsWith("/workflows/") && p !== "/workflows"),
  },
];

export function AppHeader() {
  const pathname = usePathname() || "/";

  return (
    <header className="flex h-14 w-full shrink-0 items-center justify-between gap-3 border-b bg-background px-4 sm:px-6">
      <div className="flex min-w-0 items-center gap-6">
        <Link className="flex shrink-0 items-center gap-2" href="/workflows">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img alt="Active-clone" className="size-7 rounded-md" src="/logo.png" />
          <span className="hidden font-semibold sm:inline">Active-clone</span>
        </Link>
        <nav aria-label="Main" className="hidden items-center gap-1 sm:flex">
          {NAV_ITEMS.map((item) => {
            const active = item.isActive(pathname);
            return (
              <Link
                aria-current={active ? "page" : undefined}
                className={cn(
                  "rounded-md px-3 py-1.5 text-sm transition-colors",
                  active
                    ? "bg-muted font-medium text-foreground"
                    : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                )}
                href={item.href}
                key={item.href}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
      </div>
      <div className="flex items-center gap-1">
        <UserMenu />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button aria-label="Open menu" className="sm:hidden" size="icon" variant="ghost">
              <Menu className="size-5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            {NAV_ITEMS.map((item) => (
              <DropdownMenuItem asChild key={item.href}>
                <Link
                  className={cn(item.isActive(pathname) && "font-medium")}
                  href={item.href}
                >
                  {item.label}
                </Link>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
