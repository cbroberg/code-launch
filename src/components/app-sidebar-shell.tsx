"use client";

import { usePathname } from "next/navigation";
import { BookOpen, Container } from "lucide-react";
import { cn } from "@/lib/utils";

export function AppSidebarShell({ children }: { children?: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <aside
      className="w-52 shrink-0 flex flex-col border-r border-border"
      style={{ background: "var(--sidebar, var(--background))" }}
    >
      {/* Logo */}
      <div className="border-b border-border p-3 shrink-0">
        <a href="/">
          <img src="/logo.svg" alt="Code Launcher" className="w-full h-auto" />
        </a>
      </div>

      <div className="flex-1 px-2 py-3 space-y-5 overflow-y-auto">

        {/* Nav */}
        <div className="space-y-0.5">
          <a
            href="/docker"
            className={cn(
              "flex items-center gap-2 px-2 py-1.5 rounded-md text-sm transition-colors",
              pathname === "/docker"
                ? "bg-accent text-foreground font-medium"
                : "text-muted-foreground hover:text-foreground hover:bg-accent/60"
            )}
          >
            <Container className="h-3.5 w-3.5" />
            Docker
          </a>
          <a
            href="/instructions"
            className={cn(
              "flex items-center gap-2 px-2 py-1.5 rounded-md text-sm transition-colors",
              pathname === "/instructions"
                ? "bg-accent text-foreground font-medium"
                : "text-muted-foreground hover:text-foreground hover:bg-accent/60"
            )}
          >
            <BookOpen className="h-3.5 w-3.5" />
            API docs
          </a>
        </div>

        {children}

      </div>
    </aside>
  );
}
